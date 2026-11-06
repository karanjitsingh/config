// Address-bar-style search box, modeled on Chrome's omnibox:
//   - suggestions from history, bookmarks, and open tabs, ranked by match quality ×
//     frecency (visit count, typed count, recency)
//   - inline autocomplete of sites you visit/type often ("git" → "github.com")
//   - "what you typed": a URL navigates, anything else searches with your default
//     search engine (chrome.search, same engine as the address bar)
//   - search shortcuts from config.js: "code foo", or "code" + Tab/Space
//   - "Switch to tab" for pages already open, Shift+Delete removes a history entry
// Everything runs locally against Chrome's own data; no network requests.

(() => {
  if (REOPENING) return; // focus.js is replacing this tab
  const input = document.getElementById("search");
  const box = document.getElementById("suggest");
  const backdrop = document.getElementById("cmd-backdrop");
  const MAX_ROWS = 8;
  const HISTORY_DAYS = 180;
  const SELF = chrome.runtime.getURL("");

  let history = [];              // recent HistoryItems
  let histByUrl = new Map();     // norm url → HistoryItem
  let bookmarks = new Map();     // norm url → { title, url }
  let typed = "";                // what the user actually typed (excludes inline completion)
  let rows = [];
  let sel = 0;
  let completion = null;         // { text, url } shown inline after the caret
  let seq = 0;
  let keyword = null;            // active search shortcut key, shown as a pill before the input

  // ---------- helpers ----------

  const norm = u => u.replace(/#.*$/, "").replace(/\/$/, "");
  const display = u => u.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const skip = u => !u || u.startsWith(SELF) || u.startsWith("chrome://newtab") || u.startsWith("chrome-search://");

  function looksLikeUrl(q) {
    if (/\s/.test(q)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(q) || /^(about|chrome|file|view-source):/i.test(q)) return true;
    if (/^localhost(:\d+)?([/?#]|$)/i.test(q)) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(q)) return true;
    return /^[\w-]+(\.[\w-]+)*\.[a-z]{2,24}(:\d+)?([/?#].*)?$/i.test(q);
  }
  const toUrl = q => /^[a-z][a-z0-9+.-]*:/i.test(q) ? q : (/^(localhost|\d)/i.test(q) ? "http://" : "https://") + q;

  // ---------- data ----------

  async function loadHistory() {
    if (!chrome.history) return console.warn("Home: no history permission; reload the extension");
    const items = await chrome.history.search({ text: "", startTime: Date.now() - HISTORY_DAYS * 864e5, maxResults: 10000 });
    history = items.filter(h => !skip(h.url));
    histByUrl = new Map(history.map(h => [norm(h.url), h]));
  }

  async function loadBookmarks() {
    const [root] = await chrome.bookmarks.getTree();
    const m = new Map();
    (function walk(n) {
      if (n.url && !skip(n.url)) m.set(norm(n.url), { title: splitIcon(n.title).name, url: n.url });
      (n.children || []).forEach(walk);
    })(root);
    bookmarks = m;
  }

  // ---------- ranking ----------

  // How well all terms match. Host prefix > host-part prefix > title word > URL word > substring.
  function matchScore(terms, title, url) {
    const u = display(url).toLowerCase();
    const host = u.split(/[/?#]/)[0];
    const t = title.toLowerCase();
    const wordStart = (s, term) => new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(term)}`, "u").test(s);
    let total = 0;
    for (const term of terms) {
      let s;
      if (host.startsWith(term)) s = 100;
      else if (host.split(".").some(p => p.startsWith(term))) s = 70;
      else if (wordStart(t, term)) s = 60;
      else if (wordStart(u, term)) s = 45;
      else if (t.includes(term)) s = 25;
      else if (u.includes(term)) s = 20;
      else return 0;
      total += s;
    }
    return total / terms.length;
  }

  function frecency(h) {
    if (!h) return 0;
    const days = (Date.now() - h.lastVisitTime) / 864e5;
    return (Math.log2(1 + h.visitCount) + 2 * Math.log2(1 + (h.typedCount || 0))) * (0.3 + 1 / (1 + days / 7));
  }

  function candidates(q, tabsByUrl) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = new Map();
    for (const h of history) {
      const m = matchScore(terms, h.title || "", h.url);
      if (m) out.set(norm(h.url), { kind: "history", url: h.url, title: h.title || display(h.url), m, h });
    }
    for (const [k, b] of bookmarks) {
      const m = matchScore(terms, b.title, b.url);
      if (!m) continue;
      const ex = out.get(k);
      if (ex) Object.assign(ex, { kind: "bookmark", title: b.title || ex.title, m: Math.max(ex.m, m) });
      else out.set(k, { kind: "bookmark", url: b.url, title: b.title || display(b.url), m, h: histByUrl.get(k) });
    }
    for (const [k, tab] of tabsByUrl) {
      const ex = out.get(k);
      if (ex) { ex.tab = tab; continue; }
      const m = matchScore(terms, tab.title || "", tab.url);
      if (m) out.set(k, { kind: "tab", url: tab.url, title: tab.title || display(tab.url), m, tab });
    }
    const list = [...out.values()];
    for (const c of list) {
      c.score = c.m * (1 + frecency(c.h)) * (c.kind === "bookmark" ? 1.5 : 1) + (c.kind === "bookmark" ? 20 : 0) + (c.tab ? 10 : 0);
    }
    return list.sort((a, b) => b.score - a.score);
  }

  // Inline autocomplete like Chrome: only for things you've typed before, visit
  // repeatedly, or bookmarked; completes to the site root until you type past the host.
  function inlineCandidate(q, list) {
    if (!q || /\s/.test(q)) return null;
    const lq = q.toLowerCase();
    const targets = new Map();
    for (const c of list) {
      const d = display(c.url);
      if (!d.toLowerCase().startsWith(lq)) continue;
      if (!(c.h?.typedCount > 0 || c.h?.visitCount >= 2 || c.kind === "bookmark")) continue;
      const host = d.split(/[/?#]/)[0];
      const toHost = !lq.includes("/") && lq.length <= host.length;
      const text = toHost ? host : d;
      let url = c.url;
      if (toHost) { try { url = new URL(c.url).origin + "/"; } catch { /* keep */ } }
      const t = targets.get(text.toLowerCase()) || { text, url, score: 0 };
      t.score += c.score;
      targets.set(text.toLowerCase(), t);
    }
    let best = null;
    for (const t of targets.values()) if (!best || t.score > best.score) best = t;
    return best;
  }

  // ---------- shortcut history ----------

  // Past searches for a shortcut, recovered from history URLs that fit its template:
  // "https://code.example.com/search?term=%s" + history ".../search?term=dep" → "dep".
  const tplCache = new Map();
  function templateRe(key) {
    if (tplCache.has(key)) return tplCache.get(key);
    const t = SEARCH[key].url.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const i = t.indexOf("%s");
    const before = t.slice(0, i);
    const cap = before.includes("?") ? "([^&#]+)" : "([^?#]+)"; // query param vs path segment
    const re = new RegExp(`^(?:https?://)?(?:www\\.)?${escRe(before)}${cap}`, "i");
    tplCache.set(key, re);
    return re;
  }
  const decode = s => { try { return decodeURIComponent(s.replace(/\+/g, "%20")); } catch { return s; } };

  function shortcutHistory(key, q) {
    const re = templateRe(key);
    const lq = q.toLowerCase();
    const byQuery = new Map();
    const pages = [];
    const host = engineOrigin(key).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
    for (const h of history) {
      const m = h.url.match(re);
      if (m) {
        const query = decode(m[1]).trim();
        if (!query) continue;
        const ql = query.toLowerCase();
        let s = !lq ? 50 : ql.startsWith(lq) ? 100 : new RegExp(`(^|\\W)${escRe(lq)}`).test(ql) ? 70 : ql.includes(lq) ? 40 : 0;
        if (!s && lq && (h.title || "").toLowerCase().includes(lq)) s = 20;
        if (!s) continue;
        const score = s * (1 + frecency(h));
        const ex = byQuery.get(ql);
        if (!ex || score > ex.score) byQuery.set(ql, { query, title: h.title, score, h });
        else ex.score += score * 0.25; // repeated searches rank higher
      } else if (lq && display(h.url).toLowerCase().startsWith(host)) {
        const mscore = matchScore(lq.split(/\s+/), h.title || "", h.url);
        if (mscore) pages.push({ kind: "history", url: h.url, title: h.title || display(h.url), h, score: mscore * (1 + frecency(h)) });
      }
    }
    const queries = [...byQuery.values()].sort((a, b) => b.score - a.score);
    return { queries, pages: pages.sort((a, b) => b.score - a.score) };
  }

  // ---------- update ----------

  async function update(allowInline) {
    const my = ++seq;
    const q = typed.trim();
    completion = null;
    if (!q && !keyword) { rows = []; render(""); return; }

    const sc = keyword ? { key: keyword, engine: SEARCH[keyword], query: q } : null;
    let tabsByUrl = new Map();
    if (!sc) {
      const [cur, tabs] = await Promise.all([chrome.tabs.getCurrent(), chrome.tabs.query({})]);
      tabsByUrl = new Map(tabs.filter(t => t.id !== cur?.id && !skip(t.url)).map(t => [norm(t.url), t]));
    }
    if (my !== seq) return; // a newer keystroke superseded this one

    const next = [];
    if (sc) {
      const iconUrl = engineOrigin(sc.key);
      if (q) next.push({ kind: "keyword", sc, title: q, iconUrl }); // the pill already names the site
      const { queries, pages } = shortcutHistory(sc.key, q);
      for (const p of queries) {
        if (next.length >= MAX_ROWS - Math.min(pages.length, 3)) break;
        if (p.query.toLowerCase() === q.toLowerCase()) continue;
        // Show what the page title adds beyond the query and the site name
        // ("V123: Shadow mode discrepancy" → "Shadow mode discrepancy").
        const rest = (p.title || "").replace(new RegExp(escRe(p.query), "ig"), "").replace(/^[\s\-–—:|·]+|[\s\-–—:|·]+$/g, "");
        const sub = rest.length > 3 && rest.toLowerCase() !== sc.engine.name.toLowerCase() ? rest : "Recent search";
        next.push({ kind: "keyword", sc: { ...sc, query: p.query }, title: p.query, sub, iconUrl, past: true });
      }
      for (const p of pages) {
        if (next.length >= MAX_ROWS) break;
        if (next.some(r => r.url && norm(r.url) === norm(p.url))) continue;
        next.push(p);
      }
    } else {
      const list = candidates(q, tabsByUrl);
      const inl = allowInline ? inlineCandidate(q, list) : null;
      if (inl) {
        completion = inl;
        const match = list.find(c => norm(c.url) === norm(inl.url));
        next.push({ kind: "url", url: inl.url, title: match?.title || inl.text, tab: match?.tab, h: match?.h });
      } else if (looksLikeUrl(q)) {
        next.push({ kind: "url", url: toUrl(q), title: display(toUrl(q)) });
      }
      if (SEARCH[q] && !/\s/.test(typed)) next.push({ kind: "keyhint", key: q, title: `Search ${SEARCH[q].name}`, sub: "press Tab", iconUrl: engineOrigin(q) });
      next.splice(next[0]?.kind === "url" ? 1 : 0, 0, { kind: "search", text: q, title: q, sub: "Search" });
      for (const c of list) {
        if (next.length >= MAX_ROWS) break;
        if (next.some(r => r.url && norm(r.url) === norm(c.url))) continue;
        next.push(c);
      }
    }
    rows = next;
    sel = 0;
    if (completion && input.value === typed) {
      input.value = typed + completion.text.slice(typed.length);
      input.setSelectionRange(typed.length, input.value.length);
    }
    render(q);
  }

  // ---------- rendering ----------

  const SEARCH_ICON = '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  const CLOCK_ICON = '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.8V8l2.2 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  function highlight(text, terms) {
    const frag = document.createDocumentFragment();
    if (!terms.length) { frag.append(text); return frag; }
    const re = new RegExp(terms.map(escRe).join("|"), "giu");
    let last = 0;
    for (const m of text.matchAll(re)) {
      frag.append(text.slice(last, m.index), el("b", { textContent: m[0] }));
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    return frag;
  }

  function rowNode(r, i, terms) {
    const n = el("div", { className: "sug" + (i === sel ? " sel" : ""), role: "option" });
    const iconSrc = r.past ? null : r.iconUrl || r.url;
    const ico = iconSrc ? el("img", { src: favicon(iconSrc, 32), alt: "", width: 16, height: 16 }) : el("span", { className: "sug-ico" });
    if (!iconSrc) ico.innerHTML = r.past ? CLOCK_ICON : SEARCH_ICON;
    const text = el("span", { className: "sug-text" }, el("span", { className: "sug-title" }, highlight(r.title, terms)));
    if (r.url && r.kind !== "url") text.append(el("span", { className: "sug-sub" }, " – ", highlight(display(r.url), terms)));
    else if (r.url && r.title !== display(r.url)) text.append(el("span", { className: "sug-sub" }, " – ", display(r.url)));
    else if (r.sub) text.append(el("span", { className: "sug-sub" }, ` – ${r.sub}`));
    n.append(ico, text);
    if (r.kind === "bookmark") n.append(el("span", { className: "sug-mark", textContent: "★", title: "Bookmarked" }));
    if (r.tab) {
      const b = el("button", { type: "button", className: "sug-tab", textContent: "Switch to tab" });
      b.addEventListener("mousedown", e => e.preventDefault());
      b.addEventListener("click", e => { e.stopPropagation(); switchTo(r.tab); });
      n.append(b);
    }
    if (r.kind === "history") {
      const x = el("button", { type: "button", className: "sug-del", textContent: "✕", title: "Remove from history (Shift+Delete)" });
      x.addEventListener("mousedown", e => e.preventDefault());
      x.addEventListener("click", e => { e.stopPropagation(); removeHistory(r); });
      n.append(x);
    }
    n.addEventListener("mousedown", e => e.preventDefault()); // keep focus in the input
    n.addEventListener("click", e => activate(r, e.metaKey || e.ctrlKey));
    n.addEventListener("mousemove", () => { if (sel !== i) { sel = i; mark(); } });
    return n;
  }

  function render(q) {
    if (!rows.length || document.activeElement !== input) { box.classList.add("hidden"); box.replaceChildren(); return; }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    box.replaceChildren(...rows.map((r, i) => rowNode(r, i, terms)));
    box.classList.remove("hidden");
  }

  function mark() {
    [...box.children].forEach((n, i) => n.classList.toggle("sel", i === sel));
  }

  // ---------- actions ----------

  async function openUrl(url, newTab) {
    if (newTab) return chrome.tabs.create({ url });
    const cur = await chrome.tabs.getCurrent();
    chrome.tabs.update(cur.id, { url });
  }

  async function switchTo(tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    const cur = await chrome.tabs.getCurrent();
    if (cur) chrome.tabs.remove(cur.id); // Chrome closes the new tab when you switch away
  }

  async function removeHistory(r) {
    if (!chrome.history) return;
    await chrome.history.deleteUrl({ url: r.url });
    history = history.filter(h => h.url !== r.url);
    histByUrl.delete(norm(r.url));
    update(false);
  }

  function activate(r, newTab) {
    if (!r) return;
    switch (r.kind) {
      case "search":
        if (!chrome.search) return openUrl(SEARCH.g.url.replace("%s", encodeURIComponent(r.text)), newTab);
        return chrome.search.query({ text: r.text, disposition: newTab ? "NEW_TAB" : "CURRENT_TAB" });
      case "keyword":
        return openUrl(r.sc.engine.url.replace("%s", encodeURIComponent(r.sc.query)), newTab);
      case "keyhint":
        return enterKeyword(r.key);
      case "info":
        return;
      case "tab":
        return newTab ? openUrl(r.url, true) : switchTo(r.tab);
      default:
        return openUrl(r.url, newTab);
    }
  }

  // ---------- shortcut pill (Arc-style "Tab to search") ----------

  const pill = document.getElementById("kw-pill");
  const cmd = document.getElementById("cmd");
  const PLACEHOLDER = input.placeholder;

  function engineOrigin(key) {
    try { return new URL(SEARCH[key].url.replace("%s", "")).origin + "/"; } catch { return SEARCH[key].url; }
  }

  // The pill takes the site's brand color, sampled from its favicon: the average of the
  // saturated pixels (skipping white/black/gray). Favicons come from our own origin, so
  // the canvas isn't tainted.
  async function brandColor(img) {
    try { await img.decode(); } catch { return null; }
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    let r = 0, gr = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 160) continue;
      const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
      if (max - min < 50) continue;
      r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++;
    }
    if (n < 12) return null;
    return { bg: readable(r / n, gr / n, b / n) };
  }

  // Keep the hue but clamp lightness/saturation so near-black or pastel brand colors
  // still make a legible tint in both light and dark mode.
  function readable(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    let l = (max + min) / 2;
    let s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    l = Math.min(0.56, Math.max(0.42, l));
    s = Math.max(0.5, s);
    return `hsl(${Math.round(((h * 60) + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  async function showPill() {
    const key = keyword;
    pill.querySelector("span").textContent = SEARCH[key].name;
    const img = pill.querySelector("img");
    img.hidden = false;
    img.onerror = () => { img.hidden = true; };
    img.src = favicon(engineOrigin(key), 32);
    pill.style.removeProperty("--tint");
    pill.classList.remove("hidden");
    cmd.classList.add("has-pill");
    input.placeholder = "Search";
    const color = await brandColor(img);
    if (color && keyword === key) {
      pill.style.setProperty("--tint", color.bg);
    }
  }

  function hidePill() {
    pill.classList.add("hidden");
    cmd.classList.remove("has-pill");
    input.placeholder = PLACEHOLDER;
  }

  function enterKeyword(key, rest = "") {
    keyword = key;
    typed = rest;
    input.value = rest;
    showPill();
    update(false);
  }

  // Backspace at the start of an empty query turns the pill back into text, like Arc/Chrome.
  function exitKeyword() {
    const key = keyword;
    keyword = null;
    hidePill();
    typed = key;
    input.value = key;
    update(false);
  }

  function acceptCompletion() {
    input.setSelectionRange(input.value.length, input.value.length);
    typed = input.value;
    update(false);
  }

  const hasCompletionSelected = () =>
    completion && input.selectionStart === typed.length && input.selectionEnd === input.value.length && input.value !== typed;

  // ---------- events ----------

  input.addEventListener("input", e => {
    typed = input.value;
    if (!keyword) {
      const m = typed.match(/^(\S+)\s(.*)$/s); // "code " → pill
      if (m && SEARCH[m[1]]) return enterKeyword(m[1], m[2]);
    }
    if (!typed && !keyword) return closeBar(); // deleted everything → back to the homepage
    update(!(e.inputType || "").startsWith("delete"));
  });

  input.addEventListener("keydown", e => {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      sel = (sel + (k === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      mark();
    } else if (k === "Enter") {
      e.preventDefault();
      activate(rows[sel], e.metaKey || e.ctrlKey || e.altKey);
    } else if (k === "Tab" && !e.shiftKey && typed.trim()) {
      e.preventDefault();
      if (!keyword && SEARCH[typed.trim()] && !/\s/.test(typed)) enterKeyword(typed.trim());
      else if (hasCompletionSelected()) acceptCompletion();
      else if (rows.length) { sel = (sel + 1) % rows.length; mark(); }
    } else if ((k === "ArrowRight" || k === "End") && hasCompletionSelected()) {
      acceptCompletion();
    } else if (k === "Escape") {
      e.preventDefault();
      if (hasCompletionSelected()) { input.value = typed; completion = null; }
      else { input.value = typed = ""; rows = []; keyword = null; hidePill(); closeBar(); }
    } else if ((k === "Delete" || k === "Backspace") && e.shiftKey && rows[sel]?.kind === "history") {
      e.preventDefault();
      removeHistory(rows[sel]);
    } else if (k === "Backspace" && !e.shiftKey && keyword && input.selectionStart === 0 && input.selectionEnd === 0) {
      e.preventDefault();
      exitKeyword();
    }
  });

  input.addEventListener("blur", () => box.classList.add("hidden"));

  // ---------- command bar open/close ----------

  const isOpen = () => document.body.classList.contains("cmd-open");

  function openBar({ clear = false } = {}) {
    if (clear) { input.value = typed = ""; rows = []; keyword = null; hidePill(); render(""); }
    document.body.classList.add("cmd-open");
    input.focus();
    input.select();
    if (typed.trim()) update(false);
  }

  // Closing leaves keyboard focus on the page, so typing reopens the bar right away.
  function closeBar() {
    document.body.classList.remove("cmd-open");
    box.classList.add("hidden");
    input.blur();
  }

  // Clicking outside the bar reveals the homepage underneath.
  backdrop.addEventListener("mousedown", e => {
    if (e.target === backdrop) { e.preventDefault(); closeBar(); }
  });

  // The page is the homepage until you type. Typing anywhere opens the bar with that
  // keystroke (focusing during keydown makes the browser deliver it to the input); if the
  // bar is open but lost focus, typing just refocuses it. ⌘K, "/", and ⌘V also open it.
  document.addEventListener("keydown", e => {
    if (document.querySelector("dialog[open]")) return;
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    const printable = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openBar(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") { if (!isOpen()) openBar({ clear: true }); else input.focus(); }
    else if (!isOpen() && e.key === "/") { e.preventDefault(); openBar({ clear: true }); }
    else if (printable) isOpen() ? input.focus() : openBar({ clear: true });
    else if (isOpen() && ["Backspace", "ArrowDown", "ArrowUp", "Enter"].includes(e.key)) input.focus();
  });
  // Clicks inside the bar (outside the input) shouldn't steal focus from it.
  document.getElementById("cmd").addEventListener("mousedown", e => {
    if (e.target !== input) e.preventDefault();
  });
  // ⌘K while the bar is open selects its text, like Arc.
  input.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.select(); }
  });
  document.getElementById("cmd-open").addEventListener("click", () => openBar());
  input.addEventListener("focus", () => { if (typed.trim()) update(false); });

  let bmTimer;
  for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved"]) {
    chrome.bookmarks[ev].addListener(() => { clearTimeout(bmTimer); bmTimer = setTimeout(loadBookmarks, 100); });
  }

  // Load suggestion data after the first frame so it never delays the page appearing.
  const later = window.requestIdleCallback || (f => setTimeout(f, 1));
  later(() => { loadBookmarks(); loadHistory(); }, { timeout: 300 });
})();

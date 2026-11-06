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

  // ---------- Chrome pages ----------
  // [title, url, extra words to match on]
  const CHROME_PAGES = [
    ["Settings", "chrome://settings", "preferences options"],
    ["Extensions", "chrome://extensions", "add-ons addons plugins"],
    ["Extension shortcuts", "chrome://extensions/shortcuts", "keyboard hotkeys keybindings"],
    ["History", "chrome://history", ""],
    ["Downloads", "chrome://downloads", "files"],
    ["Bookmarks", "chrome://bookmarks", "bookmark manager"],
    ["Passwords", "chrome://password-manager/passwords", "password manager passkeys logins"],
    ["Clear browsing data", "chrome://settings/clearBrowserData", "cache cookies delete history"],
    ["Privacy and security", "chrome://settings/privacy", "safe browsing"],
    ["Site settings", "chrome://settings/content", "permissions camera microphone location notifications cookies popups"],
    ["Search engines", "chrome://settings/searchEngines", "site search default search engine"],
    ["Appearance", "chrome://settings/appearance", "theme font zoom"],
    ["Autofill", "chrome://settings/autofill", "addresses payment methods cards"],
    ["Sync and Google services", "chrome://settings/syncSetup", "account sign in"],
    ["Profiles", "chrome://settings/people", "people accounts"],
    ["On startup", "chrome://settings/onStartup", "startup pages"],
    ["Default browser", "chrome://settings/defaultBrowser", ""],
    ["Languages", "chrome://settings/languages", "spell check translate"],
    ["Downloads settings", "chrome://settings/downloads", "download location"],
    ["Accessibility", "chrome://settings/accessibility", "captions"],
    ["Performance", "chrome://settings/performance", "memory saver energy"],
    ["System", "chrome://settings/system", "proxy hardware acceleration"],
    ["Reset settings", "chrome://settings/reset", ""],
    ["About Chrome", "chrome://settings/help", "version update"],
    ["Flags", "chrome://flags", "experiments"],
    ["Version", "chrome://version", "about"],
    ["Inspect devices", "chrome://inspect", "devtools debugging remote"],
    ["Policies", "chrome://policy", "managed"],
    ["Components", "chrome://components", ""],
    ["GPU", "chrome://gpu", "graphics"],
    ["Net internals", "chrome://net-internals", "dns network"],
  ].map(([title, url, words]) => ({ title, url, words }));

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
    for (const p of CHROME_PAGES) {
      const m = Math.max(matchScore(terms, p.title, p.url), matchScore(terms, `${p.title} ${p.words}`, "") * 0.8);
      if (m && !out.has(norm(p.url))) out.set(norm(p.url), { kind: "chrome", url: p.url, title: p.title, m, h: histByUrl.get(norm(p.url)) });
    }
    for (const [k, tab] of tabsByUrl) {
      const ex = out.get(k);
      if (ex) { ex.tab = tab; continue; }
      const m = matchScore(terms, tab.title || "", tab.url);
      if (m) out.set(k, { kind: "tab", url: tab.url, title: tab.title || display(tab.url), m, tab });
    }
    const list = [...out.values()];
    for (const c of list) {
      // Open tabs rank high (like Arc): you most likely want the one you already have.
      c.score = c.m * (1 + Math.max(frecency(c.h), c.tab ? 3 : 0))
        * (c.tab ? 2.5 : c.kind === "bookmark" ? 1.5 : c.kind === "chrome" ? 2.5 : 1)
        + (c.kind === "bookmark" ? 20 : 0) + (c.tab ? 40 : 0);
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
      } else {
        const lq = q.toLowerCase();
        const page = lq.length >= 3 && list.find(c => c.kind === "chrome" && c.title.toLowerCase().startsWith(lq));
        if (page) next.push(page);
      }
      if (SEARCH[q] && !/\s/.test(typed)) next.push({ kind: "keyhint", key: q, title: `Search ${SEARCH[q].name}`, sub: "press Tab", iconUrl: engineOrigin(q) });
      next.splice(["url", "chrome"].includes(next[0]?.kind) ? 1 : 0, 0, { kind: "search", text: q, title: q, sub: "Search" });
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

  // Line icons for Chrome pages (Lucide-style, 24×24 strokes rendered at 16px).
  const svg = body => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const ICONS = {
    gear: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
    puzzle: svg('<path d="M19.44 7.85c-.05.32.06.65.29.88l1.57 1.57c.47.47.7 1.09.7 1.7s-.23 1.23-.7 1.7l-1.61 1.61a.98.98 0 0 1-.84.28c-.47-.07-.8-.48-.97-.93a2.5 2.5 0 1 0-3.21 3.21c.45.17.86.5.93.97a.98.98 0 0 1-.28.84l-1.61 1.61c-.47.47-1.09.7-1.7.7s-1.23-.23-1.7-.7l-1.57-1.57a1.03 1.03 0 0 0-.88-.29c-.49.07-.84.5-1.02.97a2.5 2.5 0 1 1-3.24-3.24c.47-.18.9-.53.97-1.02a1.03 1.03 0 0 0-.29-.88l-1.57-1.57A2.4 2.4 0 0 1 2 12c0-.62.24-1.23.7-1.7l1.53-1.53c.24-.24.58-.35.92-.3.51.08.88.53 1.07 1.01a2.5 2.5 0 1 0 3.26-3.26c-.48-.2-.93-.56-1.01-1.07-.05-.34.06-.68.3-.92l1.53-1.53A2.4 2.4 0 0 1 12 2c.62 0 1.23.24 1.7.7l1.57 1.57c.23.23.56.34.88.29.49-.07.84-.5 1.02-.97a2.5 2.5 0 1 1 3.24 3.24c-.47.18-.9.53-.97 1.02z"/>'),
    keyboard: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
    star: svg('<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>'),
    key: svg('<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>'),
    trash: svg('<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
    flask: svg('<path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.13A2 2 0 0 1 14 9.53V2"/><path d="M8.5 2h7M7 16h10"/>'),
    code: svg('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'),
  };
  // First matching prefix wins (more specific first); anything else gets the gear.
  const CHROME_ICON = [
    ["chrome://extensions/shortcuts", "keyboard"], ["chrome://extensions", "puzzle"],
    ["chrome://history", "history"], ["chrome://downloads", "download"], ["chrome://settings/downloads", "download"],
    ["chrome://bookmarks", "star"], ["chrome://password-manager", "key"],
    ["chrome://settings/clearBrowserData", "trash"], ["chrome://settings/privacy", "shield"], ["chrome://settings/content", "shield"],
    ["chrome://settings/searchEngines", "search"], ["chrome://settings/people", "user"], ["chrome://settings/syncSetup", "user"],
    ["chrome://settings/help", "info"], ["chrome://version", "info"], ["chrome://policy", "info"],
    ["chrome://flags", "flask"], ["chrome://inspect", "code"], ["chrome://net-internals", "code"], ["chrome://gpu", "code"],
  ];
  const chromeIcon = url => ICONS[CHROME_ICON.find(([p]) => url.startsWith(p))?.[1] || "gear"];
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
    const isChrome = r.url?.startsWith("chrome://");
    const iconSrc = r.past || isChrome ? null : r.iconUrl || r.url;
    const ico = iconSrc ? el("img", { src: favicon(iconSrc, 32), alt: "", width: 16, height: 16 }) : el("span", { className: "sug-ico" });
    if (!iconSrc) ico.innerHTML = r.past ? CLOCK_ICON : isChrome ? chromeIcon(r.url) : SEARCH_ICON;
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

  // The homepage tab stays open: closing it would put it on Chrome's recently-closed
  // list, so ⌘⇧T would reopen the homepage instead of the tab you actually closed.
  async function switchTo(tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  async function removeHistory(r) {
    if (!chrome.history) return;
    await chrome.history.deleteUrl({ url: r.url });
    history = history.filter(h => h.url !== r.url);
    histByUrl.delete(norm(r.url));
    update(false);
  }

  // Immediate feedback on Enter: the next page can take a moment to start painting, and
  // without this the bar just sits there as if nothing happened.
  let navTimer;
  // What the bar shows while loading: the destination, not what was typed.
  function destinationText(r) {
    if (r.kind === "search") return r.text;
    if (r.kind === "keyword") return r.sc.query;
    return r.url ? display(r.url) : input.value;
  }

  function showNavigating(r) {
    input.value = destinationText(r);
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollLeft = 0; // long URLs: show the start (the host), like the address bar
    document.body.classList.add("navigating");
    box.classList.add("hidden");
    input.readOnly = true;
    clearTimeout(navTimer);
    navTimer = setTimeout(stopNavigating, 8000); // e.g. a download, or a blocked navigation
  }
  function stopNavigating() {
    clearTimeout(navTimer);
    document.body.classList.remove("navigating");
    input.readOnly = false;
  }
  // Coming back via the back/forward cache shouldn't show a stuck loading state.
  addEventListener("pageshow", stopNavigating);

  function activate(r, newTab) {
    if (!r) return;
    // Anything already open in another tab switches to it (like Arc); ⌘Enter opens a copy.
    if (r.tab && !newTab) return switchTo(r.tab);
    const navigates = !newTab && !["keyhint", "info", "tab"].includes(r.kind);
    if (navigates) showNavigating(r);
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
    try {
      const u = new URL(SEARCH[key].url.replace("%s", ""));
      return u.origin !== "null" ? `${u.origin}/` : `${u.protocol}//${u.host}/`;
    } catch { return SEARCH[key].url; }
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
  // The text comes back as typed ("is " plus any query), and stays plain text: the pill
  // only returns once the space after the key is removed and typed again.
  let literalKey = null;
  function exitKeyword() {
    const key = keyword;
    const rest = input.value;
    keyword = null;
    hidePill();
    literalKey = key;
    typed = input.value = `${key} ${rest}`;
    input.setSelectionRange(key.length + 1, key.length + 1);
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
    if (literalKey && !typed.startsWith(`${literalKey} `)) literalKey = null;
    if (!keyword && !literalKey) {
      const m = typed.match(/^(\S+)\s(.*)$/s); // "code " → pill
      if (m && SEARCH[m[1]]) return enterKeyword(m[1], m[2]);
    }
    if (!typed && !keyword) return closeBar(); // deleted everything → back to the homepage
    update(!(e.inputType || "").startsWith("delete"));
  });

  input.addEventListener("keydown", e => {
    const k = e.key;
    if (document.body.classList.contains("navigating")) {
      if (k === "Escape") stopNavigating();
      e.preventDefault();
      return;
    }
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

  // Leaving the tab resets it, so switching back shows a fresh homepage rather than a
  // half-typed search.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    input.value = typed = "";
    rows = [];
    keyword = null;
    hidePill();
    closeBar();
  });

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

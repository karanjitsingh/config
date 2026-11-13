// Arc-style peek overlay for links.
// (Plain script sharing globals with the other newtab files; see index.html for load order.)

// ---------- peek (Arc-style) ----------
// A plain click on a link on the page opens it in an overlay on the homepage instead of
// navigating away. ⌘/Ctrl/Shift/middle-click still behave normally; Settings → "Open
// links in peek" turns it off.
//
// Most sites forbid being shown inside another page (X-Frame-Options / CSP
// frame-ancestors). A session rule removes those headers, but only for frames loaded in
// this tab, so nothing changes for normal browsing.
// Per kind of link: "fav", "link" (bookmark cards), or "widget:<id>". All on by default.
function peekKind(a) {
  if (a.classList.contains("fav")) return "fav";
  if (a.classList.contains("link")) return "link";
  const w = a.closest(".card.widget")?.dataset.id;
  return w || "other";
}
function peekOn(kind) {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.peekKinds || "{}"); } catch { /* reset below */ }
  if (localStorage.peek === "off") return false; // older all-or-nothing switch
  return cfg[kind] !== false;
}
// Single favorites with peek turned off (right-click → Disable peek), by URL.
function peekOffUrls() {
  try { return new Set(JSON.parse(localStorage.peekOffUrls || "[]")); } catch { return new Set(); }
}
function setPeekOff(url, off) {
  const urls = peekOffUrls();
  if (off) urls.add(url); else urls.delete(url);
  localStorage.peekOffUrls = JSON.stringify([...urls]);
}
const PEEK_ORIGINS = ["https://*/*", "http://*/*"];
let peekRuleId = null;

async function allowFramingInThisTab() {
  if (peekRuleId !== null) return true;
  if (!chrome.declarativeNetRequest) return false;
  const tab = await new Promise(r => chrome.tabs.getCurrent(r));
  if (!tab) return false;
  peekRuleId = 1000 + (tab.id % 100000);
  const action = {
    type: "modifyHeaders",
    responseHeaders: [
      { header: "x-frame-options", operation: "remove" },
      { header: "content-security-policy", operation: "remove" },
    ],
  };
  // Two ways to recognize peek frames: by this tab, and by the extension having started
  // the frame's navigation (frames inside extension pages aren't always tied to a tab id).
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [peekRuleId, 1],
    addRules: [
      { id: peekRuleId, priority: 1, action, condition: { resourceTypes: ["sub_frame"], tabIds: [tab.id] } },
      { id: 1, priority: 1, action, condition: { resourceTypes: ["sub_frame"], initiatorDomains: [chrome.runtime.id] } },
    ],
  });
  return true;
}
addEventListener("pagehide", () => {
  if (peekRuleId !== null) chrome.declarativeNetRequest?.updateSessionRules({ removeRuleIds: [peekRuleId] });
});

const peek = {
  root: null, frame: null, title: null, host: null, icon: null, hint: null, url: "", hintTimer: 0,
  build() {
    if (this.root) return;
    const close = el("button", { type: "button", className: "peek-btn", title: "Close (Esc)", textContent: "✕" });
    // "Expand": open the page right here, replacing the homepage in this tab.
    const toTab = el("button", { type: "button", className: "peek-btn wide", title: "Open this page in this tab (⌘O)" },
      el("span", { textContent: "Expand" }), el("kbd", { className: "peek-kbd", textContent: "⌘O" }));
    // The peek's own back/forward (its navigation stays out of the tab's history).
    const chevron = d => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    this.backBtn = el("button", { type: "button", className: "peek-btn peek-nav", title: "Back (⌘[)", ariaLabel: "Back", disabled: true });
    this.fwdBtn = el("button", { type: "button", className: "peek-btn peek-nav", title: "Forward (⌘])", ariaLabel: "Forward", disabled: true });
    this.backBtn.innerHTML = chevron("M10 3.5 5.5 8l4.5 4.5");
    this.fwdBtn.innerHTML = chevron("M6 3.5 10.5 8 6 12.5");
    this.backBtn.addEventListener("click", () => this.go(-1));
    this.fwdBtn.addEventListener("click", () => this.go(1));
    this.icon = el("img", { className: "peek-ico", alt: "", width: 16, height: 16 });
    this.title = el("span", { className: "peek-title" });
    this.host = el("span", { className: "peek-host" });
    this.hint = el("div", { className: "peek-hint hidden" },
      el("span", { textContent: "Not loading? Some sites don't allow being shown here." }),
      el("button", { type: "button", className: "peek-btn wide", onclick: () => this.toTab() },
        el("span", { textContent: "Expand" }), el("kbd", { className: "peek-kbd", textContent: "⌘O" })));
    const panel = el("div", { className: "peek-panel", tabIndex: -1 },
      el("div", { className: "peek-bar" }, this.backBtn, this.fwdBtn, this.icon, this.title, this.host, el("span", { className: "peek-gap" }), toTab, close),
      this.body = el("div", { className: "peek-body" }, this.hint));
    this.root = el("div", { className: "peek-backdrop hidden" }, panel);
    this.root.addEventListener("mousedown", e => { if (e.target === this.root) this.close(); });
    close.addEventListener("click", () => this.close());
    toTab.addEventListener("click", () => this.toTab());
    // Keys and page changes from inside the peeked page (src/peek/peek-keys.js, peek-main.js).
    addEventListener("message", e => {
      const kind = e.data?.arctabPeek;
      if (!kind || !this.isOpen() || e.source !== this.frame?.contentWindow) return;
      if (kind === "page" || kind === "replace") {
        this.frame.contentWindow.postMessage({ arctabPeekColor: true }, "*"); // an app's new view may recolor its header
        return this.onPage(kind, String(e.data.url || ""), String(e.data.title || ""));
      }
      if (kind === "color") return this.setColor(this.frame.peekColor = String(e.data.color || ""));
      if (document.body.classList.contains("cmd-open")) return; // the bar on top has the keys
      if (kind === "close") this.close();
      if (kind === "expand") this.toTab();
      if (kind === "back") this.go(-1);
      if (kind === "forward") this.go(1);
    });
    document.addEventListener("keydown", e => {
      // The bar on top handles its own keys (its Esc has already closed it by the time
      // this runs, so look at defaultPrevented too).
      if (!this.isOpen() || e.defaultPrevented || document.body.classList.contains("cmd-open")) return;
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === "o" || e.key === "O" || e.key === "Enter")) { e.preventDefault(); this.toTab(); }
      if (((e.metaKey || e.ctrlKey) && e.key === "[") || (e.altKey && e.key === "ArrowLeft")) { e.preventDefault(); this.go(-1); }
      if (((e.metaKey || e.ctrlKey) && e.key === "]") || (e.altKey && e.key === "ArrowRight")) { e.preventDefault(); this.go(1); }
    });
    document.body.append(this.root);
  },
  // Closed peeks stay loaded (hidden) for a minute, so reopening the same link is
  // instant and keeps your place. A frame is never moved in the DOM: that would reload it.
  cache: new Map(), // url -> { frame, timer }
  CACHE_MS: 60_000,
  makeFrame(url) {
    const frame = el("iframe", { className: "peek-frame", referrerPolicy: "no-referrer-when-downgrade" });
    // No sandbox: a sandboxed frame loses service workers and some storage, which apps
    // like Gmail need. Chrome itself stops a cross-site frame from navigating the
    // homepage away unless you clicked inside it.
    frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen; camera; microphone; display-capture; storage-access");
    frame.addEventListener("load", () => {
      if (frame !== this.frame) return;
      this.root.classList.remove("loading");
      clearTimeout(this.hintTimer);
    });
    // Its own history: pages it has shown, and where it is in them.
    frame.nav = { list: [url], i: 0, pending: -1, started: false };
    frame.src = url; // set before inserting, so even the first load adds no history entry
    this.body.prepend(frame);
    return frame;
  },
  // A page loaded (or a single-page app changed URL) inside the current peek.
  onPage(kind, url, title) {
    const n = this.frame.nav;
    if (!url) return;
    if (kind === "replace" || !n.started) { n.list[n.i] = url; n.started = true; } // first load (after redirects) or a URL tweak
    else if (n.pending >= 0) { n.i = n.pending; n.list[n.i] = url; n.pending = -1; } // our own back/forward landed
    else if (url !== n.list[n.i]) { n.list = [...n.list.slice(0, n.i + 1), url]; n.i++; } // somewhere new
    if (title) { this.title.textContent = title; this.host.textContent = hostOf(url); }
    this.updateNav();
  },
  go(step) {
    const n = this.frame?.nav;
    const to = n ? n.i + step : -1;
    if (!n || to < 0 || to >= n.list.length) return;
    n.pending = to;
    this.root.classList.add("loading");
    this.frame.contentWindow.postMessage({ arctabPeekGo: n.list[to] }, "*"); // peek-keys.js loads it in place
  },
  // Title bar in the page's top color (from peek-keys.js); dark colors get light text.
  setColor(color) {
    const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color || "");
    const bar = this.root.querySelector(".peek-bar");
    if (!m) { bar.style.removeProperty("--peek-bar"); bar.classList.remove("tinted", "on-dark"); return; }
    const [r, g, b] = m.slice(1).map(Number);
    bar.style.setProperty("--peek-bar", color);
    bar.classList.add("tinted");
    bar.classList.toggle("on-dark", 0.299 * r + 0.587 * g + 0.114 * b < 150);
  },
  updateNav() {
    const n = this.frame?.nav;
    this.backBtn.disabled = !n || n.i <= 0;
    this.fwdBtn.disabled = !n || n.i >= n.list.length - 1;
  },
  isOpen() { return this.root && !this.root.classList.contains("hidden"); },
  // Grow out of the clicked link and shrink back into it (falls back to a plain zoom).
  fromRect: null,
  zoom(reverse) {
    const panel = this.root.querySelector(".peek-panel");
    const p = panel.getBoundingClientRect();
    const r = this.fromRect;
    const start = r
      ? `translate(${r.left + r.width / 2 - (p.left + p.width / 2)}px, ${r.top + r.height / 2 - (p.top + p.height / 2)}px) scale(${Math.max(0.08, r.width / p.width)}, ${Math.max(0.04, r.height / p.height)})`
      : "translateY(16px) scale(.96)";
    const frames = [{ transform: start, opacity: 0, borderRadius: "28px" }, { transform: "none", opacity: 1, borderRadius: "16px" }];
    const opts = { duration: reverse ? 200 : 300, easing: reverse ? "cubic-bezier(.4, 0, .9, .4)" : "cubic-bezier(.2, .9, .25, 1.05)", fill: "both" };
    const anim = panel.animate(reverse ? frames.reverse() : frames, opts);
    this.root.animate([{ opacity: reverse ? 1 : 0 }, { opacity: reverse ? 0 : 1 }], { duration: opts.duration, fill: "both" });
    return anim.finished.catch(() => {});
  },
  open(url, label, fromRect) {
    this.build();
    this.fromRect = fromRect || null;
    this.url = url;
    this.title.textContent = label || hostOf(url);
    this.host.textContent = label ? hostOf(url) : "";
    this.icon.src = favicon(url, 32);
    this.hint.classList.add("hidden");
    const cached = this.cache.get(url);
    clearTimeout(this.hintTimer);
    if (cached) {
      clearTimeout(cached.timer);
      this.cache.delete(url);
      this.frame = cached.frame;
      this.root.classList.remove("loading");
    } else {
      this.root.classList.add("loading");
      this.frame = this.makeFrame(url);
      this.hintTimer = setTimeout(() => this.hint.classList.remove("hidden"), 5000);
    }
    this.setColor(this.frame.peekColor); // a cached page keeps its color; a new one starts plain
    for (const f of this.body.querySelectorAll(".peek-frame")) f.classList.toggle("hidden", f !== this.frame);
    this.updateNav();
    this.root.classList.remove("hidden");
    document.body.classList.add("peeking");
    // Keys go to the homepage (Esc, ⌘O) until you click into the page. The panel takes
    // focus, not a button: any key press would put a focus ring on a focused button.
    this.root.querySelector(".peek-panel").focus();
    // Drop the finished open animation (it would pin opacity and block the blur-out
    // when the search bar opens over the peek).
    this.zoom(false).then(() => {
      if (!this.closing) for (const an of this.root.getAnimations({ subtree: true })) if (an.playState === "finished") an.cancel();
    });
  },
  async close() {
    if (!this.isOpen() || this.closing) return;
    this.closing = true;
    clearTimeout(this.hintTimer);
    await this.zoom(true);
    this.root.classList.add("hidden");
    for (const a of [...this.root.getAnimations({ subtree: true })]) a.cancel();
    document.body.classList.remove("peeking");
    // Keep it for a minute in case you come back; then let it go.
    const frame = this.frame, url = this.url;
    frame.classList.add("hidden");
    this.cache.get(url)?.frame.remove();
    this.cache.set(url, { frame, timer: setTimeout(() => { frame.remove(); this.cache.delete(url); }, this.CACHE_MS) });
    this.frame = null;
    this.closing = false;
  },
  toTab() {
    // Navigate this tab to the page you're on in the peek (Back returns to the homepage).
    const n = this.frame?.nav;
    location.href = n?.list[n.i] || this.url;
  },
};

async function openPeek(url, label, fromRect) {
  // Permission (first time only) has to be asked while we still have the click's gesture.
  const granted = await chrome.permissions.request({ origins: PEEK_ORIGINS }).catch(() => false);
  if (!granted || !(await allowFramingInThisTab())) { location.href = url; return; } // fall back to a normal visit
  peek.open(url, label, fromRect);
  peekDiagnostics(url); // TEMP: remove once framing works
}

// TEMP diagnostics for sites that still refuse to load in peek.
async function peekDiagnostics(url) {
  const dnr = chrome.declarativeNetRequest;
  const tab = await new Promise(r => chrome.tabs.getCurrent(r));
  console.log("[peek] url", url, "tab", tab?.id, "extension", chrome.runtime.id);
  console.log("[peek] session rules", JSON.stringify(await dnr.getSessionRules()));
  setTimeout(async () => {
    try {
      const m = await dnr.getMatchedRules({ tabId: tab.id });
      console.log("[peek] matched in this tab", JSON.stringify(m.rulesMatchedInfo));
      const all = await dnr.getMatchedRules({});
      console.log("[peek] matched anywhere", JSON.stringify(all.rulesMatchedInfo));
    } catch (e) { console.log("[peek] getMatchedRules failed", e.message); }
  }, 3000);
}

document.addEventListener("click", e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (e.target.closest?.("button, .acts, [role=button]")) return; // ☆ / ✎ / ✕ on a link do their own thing
  const a = e.target.closest?.("a[href]");
  if (!a || !/^https?:/.test(a.href) || a.closest("#cmd-backdrop, dialog, .peek-backdrop")) return;
  if (!peekOn(peekKind(a)) || peekOffUrls().has(a.getAttribute("href"))) return;
  e.preventDefault(); // the link's own click handlers (seen marks etc.) still run
  const label = a.querySelector(".label")?.textContent?.trim() || a.textContent.trim().split("\n")[0];
  openPeek(a.href, label, a.getBoundingClientRect());
}, true);

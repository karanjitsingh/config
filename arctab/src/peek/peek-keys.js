// Runs in every frame (registered by background.js), but only does anything inside a
// peek: a frame whose parent is an ArcTab page.
//
// - Keys: once you click into the peeked page, keys go to it instead of the homepage,
//   so Esc, ⌘O and back/forward (⌘[ ⌘] or ⌥← ⌥→) are forwarded from here.
// - History: navigating inside a frame normally adds entries to the whole tab's
//   back/forward list, so the homepage's ← → would step through the peek. Here link
//   clicks replace the frame's page instead (no new entry), peek-main.js does the same
//   for single-page-app navigation, and the peek keeps its own back/forward list.
(() => {
  if (window.top === window || window.parent !== window.top) return;
  const origins = location.ancestorOrigins;
  const home = `chrome-extension://${chrome.runtime.id}`;
  if (!origins || origins[0] !== home) return;
  const tell = msg => window.parent.postMessage(msg, home);

  addEventListener("keydown", e => {
    const mod = e.metaKey || e.ctrlKey;
    const action = mod && (e.key === "o" || e.key === "O") ? "expand"
      : (mod && e.key === "[") || (e.altKey && e.key === "ArrowLeft") ? "back"
      : (mod && e.key === "]") || (e.altKey && e.key === "ArrowRight") ? "forward"
      : e.key === "Escape" && !e.defaultPrevented ? "close" // the page didn't use it (closing its own popup, etc.)
      : null;
    if (!action) return;
    e.preventDefault();
    tell({ arctabPeek: action });
  });

  // A plain link click that would load a new page in this frame: load it in place of the
  // current one. Runs after the page's own handlers (window, bubble phase), so links an
  // app handles itself (defaultPrevented) are left to it.
  addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.composedPath().find(n => n.tagName === "A" && n.href);
    if (!a || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
    const url = new URL(a.href, location.href);
    if (!/^https?:$/.test(url.protocol)) return;
    if (url.href.split("#")[0] === location.href.split("#")[0] && url.hash) return; // same-page anchor
    e.preventDefault();
    location.replace(url.href);
  });

  // The peek's own back/forward: the homepage asks for a URL, we load it in place.
  addEventListener("message", e => {
    if (e.source !== window.parent || e.origin !== home || typeof e.data?.arctabPeekGo !== "string") return;
    location.replace(e.data.arctabPeekGo);
  });

  // Each page that loads here is a step in the peek's history.
  const report = () => tell({ arctabPeek: "page", url: location.href, title: document.title });
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", report, { once: true });
  else report();
})();

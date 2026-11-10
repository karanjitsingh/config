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

  // Capture phase, so pages that stop key events from bubbling can't swallow these.
  addEventListener("keydown", e => {
    if (e.key === "Escape") {
      // Close the peek unless the page used Esc itself (closing its own popup, etc.):
      // checked once the page's handlers have all run.
      setTimeout(() => { if (!e.defaultPrevented) tell({ arctabPeek: "close" }); });
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const action = mod && (e.key === "o" || e.key === "O") ? "expand"
      : (mod && e.key === "[") || (e.altKey && e.key === "ArrowLeft") ? "back"
      : (mod && e.key === "]") || (e.altKey && e.key === "ArrowRight") ? "forward"
      : null;
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    tell({ arctabPeek: action });
  }, true);

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

  // The peek's title bar takes the color of the top of the page, so it reads as the
  // page's own header. Sampled a few times while the page (or app) draws itself in.
  const solid = c => {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return a >= 0.9 ? `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})` : null;
  };
  const topColor = () => {
    for (let n = document.elementFromPoint(innerWidth / 2, 1); n; n = n.parentElement) {
      const c = solid(getComputedStyle(n).backgroundColor);
      if (c) return c;
    }
    const meta = document.querySelector('meta[name="theme-color"]')?.content;
    const probe = meta && Object.assign(document.createElement("i"), { style: `color:${meta}` });
    if (probe) { document.documentElement.append(probe); const c = solid(getComputedStyle(probe).color); probe.remove(); if (c) return c; }
    return "rgb(255, 255, 255)"; // nothing painted: the browser's white canvas
  };
  let sent = "";
  const sendColor = () => {
    const color = topColor();
    if (color !== sent) tell({ arctabPeek: "color", color: (sent = color) });
  };
  const sampleSoon = () => [0, 400, 1500, 4000].forEach(ms => setTimeout(sendColor, ms));
  if (document.readyState === "complete") sampleSoon();
  else addEventListener("load", sampleSoon, { once: true });
  addEventListener("DOMContentLoaded", sendColor, { once: true });
  addEventListener("message", e => { if (e.source === window.parent && e.origin === home && e.data?.arctabPeekColor) sampleSoon(); });
})();

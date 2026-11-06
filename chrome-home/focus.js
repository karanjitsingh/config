// Chrome always gives keyboard focus to the address bar on a new tab page, and
// extensions can't change that directly. Navigating the tab to this page's own URL
// (browser-initiated) hands focus to the page instead, so typing goes straight to the
// homepage. Two ways to do that:
//   "update": navigate the same tab (no tab-strip flicker) — tried first
//   "create": open a fresh tab at the same spot and close this one — fallback
// The page checks whether it actually got focus and remembers the method that works.
// Trade-off either way: the address bar shows this page's URL.
//
// Settings → "Put the cursor in the homepage". Off keeps Chrome's default (address bar
// focused, blank URL).
const FOCUS_PAGE = localStorage.focusPage !== "off";

const PARAMS = new URLSearchParams(location.search);
const REOPENED = PARAMS.has("focused");
// Only a genuinely fresh new tab gets the focus hand-off. A tab restored with ⌘⇧T, a
// reload, or Back/Forward just shows the page: the hand-off closes a tab, and closing a
// restored tab would put it straight back on top of Chrome's recently-closed list, so
// ⌘⇧T would keep reopening the homepage instead of the tabs you actually closed.
const NAV_TYPE = performance.getEntriesByType("navigation")[0]?.type || "navigate";
const FRESH = NAV_TYPE === "navigate" && history.length === 1;
const REOPENING = FOCUS_PAGE && !REOPENED && FRESH;

if (REOPENING) {
  // Hide content (the background still paints) so nothing flashes before the swap.
  document.documentElement.style.visibility = "hidden";
  const method = localStorage.focusMethod || "update";
  chrome.tabs.getCurrent(tab => {
    if (!tab) { document.documentElement.style.visibility = ""; return; }
    const url = chrome.runtime.getURL(`index.html?focused=${method}`);
    if (method === "update") chrome.tabs.update(tab.id, { url });
    else chrome.tabs.create({ url, index: tab.index, windowId: tab.windowId, active: true }, () => chrome.tabs.remove(tab.id));
  });
}

// Tidy the address bar: drop "?focused=…" once it's been read.
if (REOPENED) history.replaceState(null, "", location.pathname);

if (REOPENED && PARAMS.get("focused") === "update") {
  // If navigating in place left focus in the address bar, use the fallback next time.
  addEventListener("load", () => setTimeout(() => {
    if (!document.hasFocus() && document.visibilityState === "visible") localStorage.focusMethod = "create";
  }, 400));
}

// Chrome always gives keyboard focus to the address bar on a new tab page, and
// extensions can't change that directly. Navigating the tab to this page's own URL
// (browser-initiated) hands focus to the page instead, so typing goes straight to the
// homepage. Two ways to do that:
//   "update": navigate the same tab (no tab-strip flicker) — tried first
//   "create": open a fresh tab at the same spot and close this one — fallback
// The page checks whether it actually got focus and remembers the method that works.
// Trade-off either way: the address bar shows this page's URL.
//
// Set to false to keep Chrome's default (address bar focused, blank URL).
const FOCUS_PAGE = true;

const PARAMS = new URLSearchParams(location.search);
const REOPENED = PARAMS.has("focused");
const REOPENING = FOCUS_PAGE && !REOPENED;

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
} else if (REOPENED && PARAMS.get("focused") === "update") {
  // If navigating in place left focus in the address bar, use the fallback next time.
  addEventListener("load", () => setTimeout(() => {
    if (!document.hasFocus() && document.visibilityState === "visible") localStorage.focusMethod = "create";
  }, 400));
}

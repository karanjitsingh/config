// Search bar overlay (Ctrl+T on any page). Runs inside a full-window frame that
// src/background.js injects into the current page, so it has the extension's access to
// history, bookmarks and tabs. Going somewhere opens a new tab; Esc or clicking outside
// just removes the frame, so no tab is created unless you actually go somewhere.

const ARCTAB_OVERLAY = true;
const REOPENING = false; // the new tab page's focus hand-off doesn't apply here
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "dataset") Object.assign(n.dataset, v);
    else n[k] = v;
  }
  n.append(...children);
  return n;
};

// Tell the page script to remove this frame.
function closeOverlay() { parent.postMessage("arctab:close", "*"); }

// Settings → "Show favorites in the Ctrl+T search". Click opens a new tab and closes the
// overlay; ⌘-click opens it in the background and keeps the overlay up.
// Runs after the shared scripts below have loaded (favoriteStrip lives in shared.js).
if (localStorage.overlayFavs !== "off") addEventListener("DOMContentLoaded", () => {
  favoriteStrip(document.getElementById("so-favs"), (url, e) => {
    const bg = e.metaKey || e.ctrlKey;
    chrome.tabs.create({ url, active: !bg });
    if (!bg) closeOverlay();
  }).catch(e => console.warn("[arctab] favorites:", e));
});

// "ArcTab Home" from the overlay opens the homepage in a new tab.
function showHome() {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/newtab/index.html") });
  closeOverlay();
}

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

// "ArcTab Home" from the overlay opens the homepage in a new tab.
function showHome() {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/newtab/index.html") });
  closeOverlay();
}

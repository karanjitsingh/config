// Search bar overlay (Ctrl+T on any page). Runs inside a full-window frame that
// src/background.js injects into the current page, so it has the extension's access to
// history, bookmarks and tabs. Going somewhere opens a new tab; Esc or clicking outside
// just removes the frame, so no tab is created unless you actually go somewhere.

const ARCTAB_OVERLAY = true;
// Always the light look, whatever the system setting (tuned to read on any page).
document.documentElement.dataset.theme = "light";
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

// Wheel/trackpad over the frame would chain-scroll the page (or its inner scroller,
// like Gmail's list) underneath. Only the suggestion list may scroll.
addEventListener("wheel", e => { if (!e.target.closest?.("#suggest")) e.preventDefault(); }, { passive: false });

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

// Settings → "Show updates in the Ctrl+T search": what's new from widgets that publish
// updates (code reviews, ticket follow-ups), as of the last time a homepage refreshed them.
if (localStorage.overlayUpdates !== "off") addEventListener("DOMContentLoaded", () => {
  const box = document.getElementById("ov-updates");
  const MAX = 4, FRESH_MS = 24 * 3600e3;
  async function paint() {
    const { arctabUpdates: all = {} } = await chrome.storage.local.get("arctabUpdates");
    const items = Object.values(all).filter(w => Date.now() - (w.at || 0) < FRESH_MS).flatMap(w => w.items);
    box.replaceChildren(...items.slice(0, MAX).map(it => {
      // Older published items have no kind; their sub started with it.
      const kind = it.kind || (/^Code review/.test(it.sub) ? "review" : "ticket");
      const a = el("a", { className: "upd", href: it.url },
        el("span", { className: `upd-kind is-${kind}`, textContent: kind === "review" ? "Review" : kind === "ticket" ? "Ticket" : kind }),
        el("span", { className: "upd-title", textContent: it.title }),
        el("span", { className: "upd-sub", textContent: it.kind ? it.sub || "" : "" }));
      // ✓ on the right (on hover): mark it read without opening it.
      const read = el("button", { type: "button", className: "upd-read", title: "Mark as read", ariaLabel: "Mark as read", textContent: "✓" });
      read.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); markRead(it.url, a); });
      a.append(read);
      a.addEventListener("click", e => { e.preventDefault(); openUpdate(it.url, e.metaKey || e.ctrlKey); });
      return a;
    }));
    if (items.length > MAX) {
      const more = el("button", { type: "button", className: "upd-more", textContent: `${items.length - MAX} more on ArcTab Home` });
      more.addEventListener("click", showHome);
      box.append(more);
    }
  }
  // Tell the widgets it's been seen; they mark it and republish without it.
  async function recordSeen(url) {
    const { arctabOpened: opened = {} } = await chrome.storage.local.get("arctabOpened");
    const week = Date.now() - 7 * 86400e3;
    for (const [u, ms] of Object.entries(opened)) if (ms < week) delete opened[u];
    opened[url] = Date.now();
    await chrome.storage.local.set({ arctabOpened: opened });
  }
  async function markRead(url, row) {
    row.classList.add("leaving");
    await recordSeen(url);
    await dropPublished(url);
  }
  // Take it off the published list now, so it's gone even before a widget refreshes
  // (no homepage open means nothing would republish until the next refresh).
  async function dropPublished(url) {
    await navigator.locks.request("arctabUpdates", async () => {
      const { arctabUpdates: all = {} } = await chrome.storage.local.get("arctabUpdates");
      for (const [id, w] of Object.entries(all)) {
        w.items = w.items.filter(it => it.url !== url);
        if (!w.items.length) delete all[id];
      }
      await chrome.storage.local.set({ arctabUpdates: all }); // repaints via onChanged
    });
  }
  async function openUpdate(url, background) {
    await recordSeen(url);
    await dropPublished(url);
    chrome.tabs.create({ url, active: !background });
    if (!background) closeOverlay();
  }
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && "arctabUpdates" in c) paint(); });
  paint().catch(e => console.warn("[arctab] updates:", e));
});

// "ArcTab Home" from the overlay opens the homepage in a new tab.
function showHome() {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/newtab/index.html") });
  closeOverlay();
}

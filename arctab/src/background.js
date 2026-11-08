// Background service worker. Private handlers (internal endpoints) live in the
// git-ignored local/background.local.js; without it this does nothing.
// ---------- Ctrl+T: search bar over the current page ----------
// ⌘T is reserved by Chrome, so the overlay has its own shortcut (Ctrl+T on a Mac, Alt+T
// elsewhere; change it in chrome://extensions/shortcuts). It draws the search bar in a
// frame over the page you're on; nothing opens unless you pick a destination.
// Pages extensions can't touch (chrome://, the Web Store) get a normal new tab.
const HOME_PREFIX = chrome.runtime.getURL("");
const OVERLAY_URL = chrome.runtime.getURL("src/overlay/overlay.html");

// Runs in the page: add the overlay frame, or remove it if it's already there.
function toggleOverlay(src) {
  const id = "__arctab_overlay";
  const old = document.getElementById(id);
  if (old) { old.remove(); return; }
  const f = document.createElement("iframe");
  f.id = id;
  f.src = src;
  f.allow = "clipboard-read; clipboard-write";
  f.setAttribute("style", "position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483647;background:transparent;color-scheme:normal;");
  const onMessage = e => {
    if (e.source !== f.contentWindow || e.data !== "arctab:close") return;
    removeEventListener("message", onMessage);
    f.remove();
  };
  addEventListener("message", onMessage);
  f.addEventListener("load", () => f.focus());
  document.documentElement.append(f);
}

chrome.commands.onCommand.addListener(async command => {
  if (command !== "open-search") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return chrome.tabs.create({});
  if (tab.url?.startsWith(HOME_PREFIX) || /^chrome:\/\/newtab/.test(tab.url || "")) {
    return chrome.runtime.sendMessage({ type: "arctab:open-bar" }).catch(() => {});
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: toggleOverlay, args: [OVERLAY_URL] });
  } catch {
    chrome.tabs.create({}); // can't draw on this page
  }
});

try { importScripts("../local/background.local.js"); } catch { /* no private handlers installed */ }

// TEMP diagnostics for peek framing (unpacked extensions only): log every rule match.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(i =>
  console.log("[peek] rule", i.rule.ruleId, "matched", i.request.type, i.request.url, "tab", i.request.tabId, "initiator", i.request.initiator));

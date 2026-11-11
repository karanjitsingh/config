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
function toggleOverlay(src, zoom) {
  const id = "__arctab_overlay";
  const old = document.getElementById(id);
  if (old) { old.remove(); return "was-open"; }
  const f = document.createElement("iframe");
  f.id = id;
  f.src = zoom && Math.abs(zoom - 1) > 0.001 ? `${src}?zoom=${zoom}` : src; // the overlay undoes page zoom (⌘+ / ⌘−)
  f.allow = "clipboard-read; clipboard-write";
  f.setAttribute("style", "position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483647;background:transparent;color-scheme:normal;");
  // The page stays still because the frame swallows wheel/trackpad scrolling
  // (overlay.js). Hiding the page's scrollbar instead would shift its layout.
  // Pinch zoom magnifies the page, fixed elements included. Keep the frame at 1:1 over
  // whatever part of the page is on screen: sized up by the zoom, then scaled back down.
  const vv = window.visualViewport;
  const fit = () => {
    const s = vv?.scale || 1;
    if (Math.abs(s - 1) < 0.001) {
      f.style.left = f.style.top = "0";
      f.style.removeProperty("transform");
      f.style.width = "100vw";
      f.style.height = "100vh";
      return;
    }
    f.style.left = `${vv.offsetLeft}px`;
    f.style.top = `${vv.offsetTop}px`;
    f.style.width = `${vv.width * s}px`;
    f.style.height = `${vv.height * s}px`;
    f.style.transformOrigin = "0 0";
    f.style.transform = `scale(${1 / s})`;
  };
  const close = () => {
    removeEventListener("message", onMessage);
    removeEventListener("keydown", onKey, true);
    vv?.removeEventListener("resize", fit);
    vv?.removeEventListener("scroll", fit);
    f.remove();
  };
  const onMessage = e => { if (e.source === f.contentWindow && e.data === "arctab:close") close(); };
  // If focus never made it into the frame, Esc lands on the page: close from here too.
  const onKey = e => { if (e.key === "Escape" && document.getElementById(id) === f) { e.preventDefault(); e.stopPropagation(); close(); } };
  addEventListener("message", onMessage);
  addEventListener("keydown", onKey, true);
  vv?.addEventListener("resize", fit);
  vv?.addEventListener("scroll", fit);
  fit();
  f.addEventListener("load", () => f.focus());
  document.documentElement.append(f);
}

// ---------- fresh updates for the overlay ----------
// The overlay shows what widgets last published. Widgets only refresh on a visible
// homepage, so each Ctrl+T also runs a one-shot refresh in an offscreen document.
const UPDATES_DOC = "src/offscreen/updates.html";
let refreshing = null;
async function refreshUpdates() {
  if (refreshing || !chrome.offscreen) return;
  refreshing = (async () => {
    try {
      if ((await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length) await chrome.offscreen.closeDocument();
      await chrome.offscreen.createDocument({ url: UPDATES_DOC, reasons: ["LOCAL_STORAGE"], justification: "Refresh code review and ticket updates for the search overlay" });
      await new Promise(done => {
        const t = setTimeout(done, 30_000);
        const on = msg => { if (msg?.type === "arctab:updates-done") { clearTimeout(t); chrome.runtime.onMessage.removeListener(on); done(); } };
        chrome.runtime.onMessage.addListener(on);
      });
      await chrome.offscreen.closeDocument().catch(() => {});
    } catch (e) { console.warn("[arctab] updates refresh:", e); }
  })().finally(() => { refreshing = null; });
}

// The offscreen page's stand-in for the APIs it doesn't get (src/offscreen/updates.js).
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Our own offscreen page only (no tab; its URL can carry extras, so match the path).
  if (msg?.type !== "arctab:offscreen" || sender.id !== chrome.runtime.id || sender.tab
      || !String(sender.url || "").startsWith(chrome.runtime.getURL(UPDATES_DOC))) return;
  const { op, arg } = msg;
  const run = op === "get" ? chrome.storage.local.get(arg)
    : op === "set" ? chrome.storage.local.set(arg)
    : op === "remove" ? chrome.storage.local.remove(arg)
    : op === "contains" ? chrome.permissions.contains(arg)
    : Promise.reject(new Error(`unknown op ${op}`));
  run.then(r => reply(r ?? null), e => reply(null));
  return true;
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== "open-search") return;
  refreshUpdates();
  // Settings → "Search over the current page" off: the shortcut is just a new tab.
  const { ctrlTOverlay } = await chrome.storage.local.get("ctrlTOverlay");
  if (ctrlTOverlay === false) return chrome.tabs.create({});
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return chrome.tabs.create({});
  const newTab = () => chrome.tabs.create({ windowId: tab.windowId }); // same window, incognito or not
  if (tab.url?.startsWith(HOME_PREFIX) || /^chrome:\/\/newtab/.test(tab.url || "")) {
    // Pressed again with the bar already up: open a real new tab, like Arc's ⌘T ⌘T.
    const reply = await chrome.runtime.sendMessage({ type: "arctab:open-bar" }).catch(() => null);
    if (reply === "was-open") newTab();
    return;
  }
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: toggleOverlay, args: [OVERLAY_URL, await chrome.tabs.getZoom(tab.id).catch(() => 1)] });
    if (res?.result === "was-open") newTab();
  } catch {
    newTab(); // can't draw on this page
  }
});

// ---------- peek: keys and history from inside the peeked page ----------
// src/peek/peek-keys.js forwards Esc / ⌘O / back / forward to the homepage and keeps the
// peek's navigation out of the tab's history (with src/peek/peek-main.js). It has to be in every frame (we
// can't know in advance what you'll peek), so it needs the https/http access that peek
// already asks for; registered once that's granted.
let peekKeysChain = Promise.resolve();
function ensurePeekKeys() {
  peekKeysChain = peekKeysChain.then(async () => {
    const matches = ["https://*/*", "http://*/*"];
    if (!(await chrome.permissions.contains({ origins: matches }))) return;
    const scripts = [
      { id: "peek-keys", matches, js: ["src/peek/peek-keys.js"], allFrames: true, runAt: "document_start" },
      { id: "peek-main", matches, js: ["src/peek/peek-main.js"], allFrames: true, runAt: "document_start", world: "MAIN" },
    ];
    const have = new Set((await chrome.scripting.getRegisteredContentScripts({ ids: scripts.map(s => s.id) })).map(s => s.id));
    const missing = scripts.filter(s => !have.has(s.id));
    if (missing.length) await chrome.scripting.registerContentScripts(missing);
  }).catch(e => { if (!/Duplicate script ID/.test(e.message)) console.warn("[arctab] peek keys:", e); });
}
chrome.runtime.onInstalled.addListener(ensurePeekKeys);
chrome.runtime.onStartup.addListener(ensurePeekKeys);
chrome.permissions.onAdded.addListener(ensurePeekKeys);
ensurePeekKeys();

try { importScripts("../local/background.local.js"); } catch { /* no private handlers installed */ }

// TEMP diagnostics for peek framing (unpacked extensions only): log every rule match.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(i =>
  console.log("[peek] rule", i.rule.ruleId, "matched", i.request.type, i.request.url, "tab", i.request.tabId, "initiator", i.request.initiator));

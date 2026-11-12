// Shared by the new tab page and the toolbar popup.
//
// Layout (root = "Other bookmarks"):
//   Other bookmarks/
//     Favorites/   → tiles at the top (pinned)
//     <folder>/    → one section card each; nested folders are collapsible groups
//     Archive/     → collapsed section at the bottom
//     (loose links)→ "Pages" section
//   Bookmarks bar  → its own section

const FAV_TITLE = "Favorites";
const ARCHIVE_TITLE = "Archive";
const LEGACY_HOME_TITLE = "Home"; // v2 kept everything in Other bookmarks/Home

// Running in an incognito window (ArcTab allowed in incognito at chrome://extensions).
// Then everything is a plain search bar: no bookmarks, history, tabs, widgets or updates.
const IN_INCOGNITO = !!chrome.extension?.inIncognitoContext;

const isFolder = n => !n.url;
const bm = chrome.bookmarks;

async function rootFolders() {
  const [root] = await bm.getTree();
  const bar = root.children.find(c => c.folderType === "bookmarks-bar") || root.children[0];
  const other = root.children.find(c => c.folderType === "other") || root.children[1];
  return { bar, other };
}

// One-time move from the v2 layout: everything already in Other bookmarks goes to
// Archive, then the contents of Home are lifted up into Other bookmarks.
// Guarded by a flag so a folder you later name "Home" never triggers it again.
async function migrateFromHome(other) {
  const { layoutV3 } = await chrome.storage.local.get("layoutV3");
  if (layoutV3) return;
  const kids = await bm.getChildren(other.id);
  const home = kids.find(k => isFolder(k) && k.title === LEGACY_HOME_TITLE);
  if (home) {
    const archive = kids.find(k => isFolder(k) && k.title === ARCHIVE_TITLE)
      || await bm.create({ parentId: other.id, title: ARCHIVE_TITLE });
    for (const k of kids) {
      if (k.id !== home.id && k.id !== archive.id) await bm.move(k.id, { parentId: archive.id });
    }
    for (const k of await bm.getChildren(home.id)) await bm.move(k.id, { parentId: other.id });
    await bm.move(archive.id, { parentId: other.id }); // keep Archive last
    if (!(await bm.getChildren(home.id)).length) await bm.remove(home.id);
  }
  await chrome.storage.local.set({ layoutV3: true });
}

// Returns { bar, other, fav, archive }. Creates Favorites if missing.
async function ensureLayout() {
  const { bar, other } = await rootFolders();
  await migrateFromHome(other);
  const kids = await bm.getChildren(other.id);
  let fav = kids.find(k => isFolder(k) && k.title === FAV_TITLE);
  if (!fav) fav = await bm.create({ parentId: other.id, title: FAV_TITLE, index: 0 });
  const archive = kids.find(k => isFolder(k) && k.title === ARCHIVE_TITLE) || null;
  return { bar, other, fav, archive };
}

// Serialized so two tabs opening at once can't both migrate.
const loadLayout = () => navigator.locks.request("home-layout", ensureLayout);

// Another extension's page: Chrome has no favicon for it, so use that extension's own icon
// (needs the "management" permission; Chrome serves a puzzle piece if it has none).
const favicon = (url, size) => {
  const ext = /^chrome-extension:\/\/([a-p]{32})\//.exec(url || "")?.[1];
  if (ext && ext !== chrome.runtime.id) return `chrome://extension-icon/${ext}/${size >= 48 ? 128 : size > 16 ? 32 : 16}/1`;
  return `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=${size}`;
};

// Custom icons live in the bookmark title itself: "🚀 Taskei" → { emoji: "🚀", name: "Taskei" }.
const EMOJI_RE = /^(\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*)/u;
function splitIcon(title = "") {
  const m = title.match(EMOJI_RE);
  if (!m || !/^\s/.test(title.slice(m[1].length))) return { emoji: "", name: title };
  return { emoji: m[1], name: title.slice(m[1].length).trim() };
}
// Returns the emoji if `s` starts with one, else "".
const firstEmoji = s => (s.trim().match(EMOJI_RE) || [""])[0];

// Favorite tiles for the search-bar views (search-only new tab, Ctrl+T overlay): plain
// links, no editing. `onOpen(url, event)` handles the click; without it links just navigate.
async function favoriteStrip(nav, onOpen) {
  const { fav } = await loadLayout();
  const links = (await chrome.bookmarks.getChildren(fav.id)).filter(c => c.url);
  const mk = (tag, cls, props = {}) => Object.assign(document.createElement(tag), { className: cls }, props);
  nav.replaceChildren(...links.map((b, i) => {
    const { emoji, name } = splitIcon(b.title);
    const label = name || hostOf(b.url);
    let ico;
    if (emoji) ico = mk("i", "emoji", { textContent: emoji, style: "width:28px;height:28px;font-size:25px" });
    else {
      ico = mk("img", "", { src: favicon(b.url, 56), alt: "", width: 28, height: 28 });
      ico.onerror = () => ico.replaceWith(mk("i", "letter", { textContent: label[0].toUpperCase(), style: "width:28px;height:28px;font-size:17px" }));
    }
    const a = mk("a", "fav", { href: b.url, title: b.url });
    if (i < 9) a.dataset.n = i + 1; // 1–9 opens it (see omnibox.js)
    a.append(ico, mk("span", "label", { textContent: label }));
    if (onOpen) a.addEventListener("click", e => { e.preventDefault(); onOpen(b.url, e); });
    return a;
  }));
}

// Open a page in a Chrome incognito window: a new tab in the one already open, if ArcTab
// can see it (only when it's allowed in incognito at chrome://extensions), else a new window.
async function openIncognito(url) {
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] }).catch(() => []);
  const win = wins.find(w => w.incognito && w.focused) || wins.find(w => w.incognito);
  if (!win) return chrome.windows.create({ url, incognito: true, focused: true });
  await chrome.tabs.create({ windowId: win.id, url, active: true });
  await chrome.windows.update(win.id, { focused: true });
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function normalizeUrl(u) {
  u = u.trim();
  if (!u) return u;
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
}

// Another extension's page can only be opened in a new tab: Chrome blocks loading it into
// an existing one (ERR_BLOCKED_BY_CLIENT), even through chrome.tabs.update.
const isOtherExtPage = url => /^chrome-extension:\/\/([a-p]{32})\//.exec(url || "")?.[1] !== chrome.runtime.id && /^chrome-extension:/.test(url || "");
// Open in this tab, or right next to it when it has to be a new one.
async function openHere(url) {
  const cur = await chrome.tabs.getCurrent();
  if (!cur) return chrome.tabs.create({ url });
  if (isOtherExtPage(url)) return chrome.tabs.create({ url, index: cur.index + 1, windowId: cur.windowId });
  return chrome.tabs.update(cur.id, { url });
}

// Links a page can't follow itself: other extensions' pages (chrome-extension://<id>/…),
// chrome:// pages and file://. Chrome blocks those navigations from a page, so a favorite
// or bookmark pointing at one did nothing; open them through the tabs API instead.
// Click opens here, ⌘/Ctrl or middle click in a background tab, Shift in a new tab.
// Runs after other handlers (bubble phase), so anything that opens links its own way wins.
{
  const webLink = u => /^(https?|mailto|tel|javascript|data|blob):/i.test(u) || u.startsWith(location.origin + "/");
  const open = e => {
    if (e.defaultPrevented || (e.type === "click" ? e.button !== 0 : e.button !== 1)) return;
    const a = e.target.closest?.("a[href]");
    if (!a || webLink(a.href) || !chrome.tabs) return;
    e.preventDefault();
    const url = a.href;
    if (e.button === 1 || e.metaKey || e.ctrlKey) return chrome.tabs.create({ url, active: false });
    if (e.shiftKey) return chrome.tabs.create({ url });
    openHere(url);
  };
  document.addEventListener("click", open);
  document.addEventListener("auxclick", open);
}

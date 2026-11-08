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

const favicon = (url, size) =>
  `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=${size}`;

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

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function normalizeUrl(u) {
  u = u.trim();
  if (!u) return u;
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
}

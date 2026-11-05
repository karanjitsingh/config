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

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function normalizeUrl(u) {
  u = u.trim();
  if (!u) return u;
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
}

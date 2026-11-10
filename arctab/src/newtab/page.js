// Page lifecycle: building the page from bookmarks, instant first paint, clock, footer, and startup.
// (Plain script sharing globals with the other newtab files; see index.html for load order.)

async function load() {
  const { bar, other, fav, archive } = await loadLayout();
  const [root] = await bm.getTree();
  const nodes = new Map();
  (function index(n) { nodes.set(n.id, n); (n.children || []).forEach(index); })(root);
  const otherTree = nodes.get(other.id);
  const barTree = nodes.get(bar.id);
  const favNode = nodes.get(fav.id);
  const seen = new Set();
  const dupes = favNode.children.filter(c => c.url && (seen.has(c.url) || !seen.add(c.url)));
  if (dupes.length) { for (const d of dupes) await bm.remove(d.id); return; } // removal re-triggers load
  Object.assign(state, { bar, other, fav, archive, root, nodes });
  state.pinned = new Set(favNode.children.filter(c => c.url).map(c => c.url));

  const favs = $("#favorites");
  // #favorites survives re-renders, so attach its drop handlers only once.
  if (!favs.dataset.zone) { dropZone(favs, () => state.fav.id); favs.dataset.zone = "1"; }
  const favNodes = favNode.children.filter(c => c.url).map(c => linkNode(c, "fav", []));

  await loadSavedLayout();
  if (layout.version < LAYOUT_VERSION) upgradeLayout(otherTree, barTree);

  // The card for a folder id: [folderNode, cardOptions], or null if it's gone.
  const folderCard = id => {
    const n = nodes.get(id);
    if (!n || n.url) return null;
    if (id === other.id) return [{ id, title: "Pages", children: n.children.filter(c => c.url) }, { virtual: true }];
    if (id === bar.id) return [{ ...n, title: "Bookmarks bar" }, { fixed: true }];
    return [n, { fixed: id === archive?.id }];
  };

  const widgets = [];
  let pruned = false;
  const colNodes = layout.cols.map((ids, i) => {
    const col = columnNode(i);
    for (const id of [...ids]) {
      if (isWidgetKey(id)) {
        const def = WIDGETS.get(id.slice("widget:".length));
        if (def) { col.append(widgetCard(def)); widgets.push(def); } // unregistered (no local file): keep its spot
        continue;
      }
      const card = folderCard(id);
      if (card) col.append(cardNode(...card));
      else { ids.splice(ids.indexOf(id), 1); pruned = true; } // folder deleted elsewhere
    }
    return col;
  });
  if (pruned) saveLayout();

  // Commit everything in one synchronous step (no awaits above this point touch the DOM),
  // so the browser never paints a half-rendered page.
  const sections = $("#sections");
  reuseImages([...favNodes, ...colNodes], [favs, sections]);
  favs.replaceChildren(...favNodes);
  sections.style.setProperty("--cols", layout.columns);
  sections.replaceChildren(...colNodes);
  $("#col-count").textContent = layout.columns;
  arrange();
  observeCards();
  markReady();
  saveSnapshot();
  for (const d of widgets) refreshWidget(d);
}

// Before v2 every top-level folder showed automatically. Keep exactly what was on the
// page: lay out anything the old version would have auto-placed, then drop what was
// hidden or never added.
function upgradeLayout(otherTree, barTree) {
  const defaults = [];
  if (otherTree.children.some(c => c.url)) defaults.push({ id: otherTree.id, children: otherTree.children.filter(c => c.url) });
  if (barTree.children.length) defaults.push(barTree);
  for (const c of otherTree.children) {
    if (isFolder(c) && c.id !== state.fav.id && c.id !== state.archive?.id) defaults.push(c);
  }
  const archiveNode = state.archive && state.nodes.get(state.archive.id);
  if (archiveNode) defaults.push(archiveNode);
  placeNewSections(defaults, state.archive?.id);
  const { widgets = [], hidden = [] } = layout.legacy || {};
  layout.cols = layout.cols.map(c => c.filter(id =>
    isWidgetKey(id) ? widgets.includes(id.slice("widget:".length)) : !hidden.includes(id)));
  layout.version = LAYOUT_VERSION;
  saveLayout();
}


// Swap freshly built <img> nodes for already-loaded ones with the same src, so icons
// don't blink while the snapshot (or a previous render) is replaced.
function reuseImages(newRoots, oldRoots) {
  const loaded = new Map();
  for (const root of oldRoots) {
    for (const img of root.querySelectorAll("img")) {
      if (!img.complete || !img.naturalWidth) continue;
      const src = img.getAttribute("src");
      loaded.has(src) ? loaded.get(src).push(img) : loaded.set(src, [img]);
    }
  }
  for (const root of newRoots) {
    for (const img of root.querySelectorAll("img")) {
      const reuse = loaded.get(img.getAttribute("src"))?.pop();
      if (reuse) img.replaceWith(reuse);
    }
  }
}

// main stays hidden (see style.css) until it has real content, so the first visible
// frame is the finished page rather than a header/footer with nothing in between.
const markReady = () => document.documentElement.classList.add("ready");

// ---------- instant first paint ----------
// The last rendered homepage is kept in localStorage (synchronous to read) and painted
// before the async bookmark load, so a new tab shows its content on the very first
// frame. The real render replaces it a few ms later with identical markup + handlers.
const SNAPSHOT_KEY = "homeSnapshot";

function saveSnapshot() {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      fav: $("#favorites").innerHTML,
      sections: $("#sections").innerHTML,
      height: $("#sections").style.height,
      cols: layout.columns,
    }));
  } catch { /* storage full or unavailable: just skip the snapshot */ }
}

function paintSnapshot() {
  try {
    const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    if (!snap) return;
    $("#favorites").innerHTML = snap.fav;
    $("#sections").innerHTML = snap.sections;
    $("#sections").style.height = snap.height || "";
    $("#sections").style.setProperty("--cols", snap.cols);
    $("#col-count").textContent = snap.cols;
    markReady();
  } catch { /* corrupt snapshot: ignore, the real render follows */ }
}

// Our own edits fire these too, so this is the only re-render path.
let reloadTimer;
const scheduleLoad = () => { if (!homeShown) return; clearTimeout(reloadTimer); reloadTimer = setTimeout(() => load().catch(e => showError(String(e?.message || e))), 50); };
if (bm) {
  for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"]) {
    bm[ev].addListener(scheduleLoad);
  }
}

function showError(msg) {
  markReady();
  $("#sections").replaceChildren(el("div", { className: "card error" }, el("h2", { textContent: "Can't load bookmarks" }),
    el("div", { className: "empty", textContent: msg })));
}

// ---------- clock ----------

function tick() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("#date").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

// ---------- search ----------
// The command bar (search box) is driven by omnibox.js.


$("#col-minus").addEventListener("click", () => setColumns(layout.columns - 1));
$("#col-plus").addEventListener("click", () => setColumns(layout.columns + 1));
$("#add-card").addEventListener("click", openAddDialog);


// Right-click anywhere on the page background. Links, inputs, selected text and
// anything with its own menu (favorite tiles, code reviews) keep theirs.
document.addEventListener("contextmenu", e => {
  if (e.defaultPrevented || REOPENING || !state.fav) return;
  if (e.target.closest("a, input, textarea, dialog, #cmd-backdrop") || String(getSelection())) return;
  e.preventDefault();
  showMenu(e.clientX, e.clientY, [
    ["Add favorite", () => addLink(state.fav.id, "Add favorite")],
    ["Add to page", openAddDialog],
    ["Settings", () => $("#open-settings").click()],
    ["Open bookmark manager", () => $("#manage").click()],
  ]);
});
$("#add-back").addEventListener("click", () => showAddView("main"));
$("#manage").addEventListener("click", e => {
  e.preventDefault();
  chrome.tabs.create({ url: `chrome://bookmarks/?id=${state.other.id}` });
});

tick();
setInterval(tick, 10_000);
// Settings → "New tabs open to just the search bar": the tab starts as only the command
// bar, and the homepage is built when you ask for it (type "home").
var homeShown = false;
function showHome() {
  if (homeShown || IN_INCOGNITO) return; // incognito never shows the homepage
  homeShown = true;
  document.body.classList.remove("search-only");
  $("#so-favs").replaceChildren();
  paintSnapshot();
  load().catch(e => showError(String(e?.message || e)));
  setTimeout(markReady, 600); // never stay hidden if something stalls
}

// Favorites as plain tiles under the bar on a
// search-only tab. Clicking one goes there in this tab; ⌘-click opens a new tab.
function searchFavs() {
  favoriteStrip($("#so-favs")).then(() => { if (homeShown) $("#so-favs").replaceChildren(); });
}

if (REOPENING) { /* focus.js is replacing this tab */ }
else if (!bm) showError("The extension doesn't have bookmarks permission yet. Open chrome://extensions and click the reload icon on ArcTab.");
else if (IN_INCOGNITO) { document.body.classList.add("search-only", "private"); markReady(); }
else if (localStorage.newTabMode === "search") { document.body.classList.add("search-only"); markReady(); searchFavs(); }
else showHome();

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

const state = { other: null, bar: null, fav: null, archive: null, pinned: new Set() };
let allLinks = []; // { node, text, parents } for the filter
// ---------- saved layout ----------
// Kept in chrome.storage.local (bookmark IDs are per-machine, so this isn't synced).
//   columns:   number of columns
//   cols:      section ids per column, top to bottom (ids not currently present are kept
//              so a section that disappears and comes back returns to its spot)
//   collapsed: section ids that are collapsed
//   open:      group (sub-folder) ids that are expanded
const LAYOUT_KEY = "layout";
const MAX_COLS = 5;
const layout = { columns: 3, cols: [[], [], []], collapsed: new Set(), open: new Set(), loaded: false };
const openGroups = layout.open;

async function loadSavedLayout() {
  if (layout.loaded) return;
  const { [LAYOUT_KEY]: saved } = await chrome.storage.local.get(LAYOUT_KEY);
  if (saved) {
    layout.columns = saved.columns;
    layout.cols = saved.cols;
    saved.collapsed.forEach(id => layout.collapsed.add(id));
    saved.open.forEach(id => layout.open.add(id));
  } else {
    JSON.parse(localStorage.openGroups || "[]").forEach(id => layout.open.add(id)); // from v3
  }
  layout.loaded = true;
}

function saveLayout() {
  return chrome.storage.local.set({ [LAYOUT_KEY]: {
    columns: layout.columns, cols: layout.cols,
    collapsed: [...layout.collapsed], open: [...layout.open],
  } });
}
const saveOpenGroups = saveLayout;

function fitColumns() {
  while (layout.cols.length < layout.columns) layout.cols.push([]);
  while (layout.cols.length > layout.columns) layout.cols[layout.cols.length - 2].push(...layout.cols.pop());
}

// Place sections the layout hasn't seen yet. Each goes to the column with the least
// content (by row count, so it's deterministic), Archive goes last and starts collapsed.
// Placement happens once and is saved; after that nothing moves unless you move it.
function placeNewSections(sections, archiveId) {
  fitColumns();
  const known = new Set(layout.cols.flat());
  const fresh = sections.filter(s => !known.has(s.id));
  if (!fresh.length) return;
  const present = new Map(sections.map(s => [s.id, s]));
  const weight = col => col.reduce((n, id) => n + (present.has(id) ? 2 + rows(present.get(id)) : 0), 0);
  for (const s of fresh) {
    if (s.id === archiveId) {
      layout.cols[layout.cols.length - 1].push(s.id);
      layout.collapsed.add(s.id);
      continue;
    }
    const col = layout.cols.reduce((a, b) => (weight(b) < weight(a) ? b : a));
    const ai = col.indexOf(archiveId);
    ai === -1 ? col.push(s.id) : col.splice(ai, 0, s.id); // keep Archive at the bottom
  }
  saveLayout();
}
const rows = f => (f.children || []).length;

function moveSection(id, colIndex, beforeId) {
  layout.cols.forEach(c => { const i = c.indexOf(id); if (i !== -1) c.splice(i, 1); });
  const col = layout.cols[colIndex];
  const i = beforeId ? col.indexOf(beforeId) : -1;
  i === -1 ? col.push(id) : col.splice(i, 0, id);
  saveLayout();
  load();
}

function setColumns(n) {
  layout.columns = Math.max(1, Math.min(MAX_COLS, n));
  fitColumns();
  saveLayout();
  load();
}

// ---------- small UI helpers ----------

function icon(url, size, title) {
  const img = el("img", { src: favicon(url, size * 2), alt: "", width: size, height: size });
  img.onerror = () => img.replaceWith(el("i", {
    className: "letter",
    style: `width:${size}px;height:${size}px;font-size:${size * 0.6}px`,
    textContent: (title || hostOf(url) || "?")[0].toUpperCase(),
  }));
  return img;
}

function actBtn(label, title, onClick, extraClass = "") {
  const b = el("button", { type: "button", className: `act ${extraClass}`, title, textContent: label });
  b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}

const editor = $("#editor");
function openEditor({ heading, title = "", url = "", folder = false }) {
  const f = editor.querySelector("form");
  const fTitle = f.elements.namedItem("title");
  const fUrl = f.elements.namedItem("url");
  $("#ed-heading").textContent = heading;
  fTitle.value = title;
  fUrl.value = url;
  $("#ed-url-row").classList.toggle("hidden", folder);
  editor.returnValue = "";
  editor.showModal();
  (folder || title ? fTitle : fUrl).select();
  return new Promise(resolve => {
    editor.addEventListener("close", () => {
      if (editor.returnValue !== "ok") return resolve(null);
      const t = fTitle.value.trim();
      const u = normalizeUrl(fUrl.value);
      if (folder ? !t : !u) return resolve(null);
      resolve({ title: t || hostOf(u), url: u });
    }, { once: true });
  });
}

let toastTimer;
function toast(msg, undo) {
  const t = $("#toast");
  t.querySelector("span").textContent = msg;
  const b = t.querySelector("button");
  b.classList.toggle("hidden", !undo);
  b.onclick = async () => { t.classList.add("hidden"); await undo(); };
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 6000);
}

// ---------- bookmark actions ----------

async function removeLink(b, msg) {
  await bm.remove(b.id);
  toast(`${msg} “${b.title}”`, () =>
    bm.create({ parentId: b.parentId, index: b.index, title: b.title, url: b.url }));
}

async function togglePin(b) {
  if (state.pinned.has(b.url)) {
    const favs = await bm.getChildren(state.fav.id);
    for (const f of favs.filter(f => f.url === b.url)) await bm.remove(f.id);
    toast(`Unpinned “${b.title}”`);
  } else {
    await bm.create({ parentId: state.fav.id, title: b.title, url: b.url });
    toast(`Pinned “${b.title}”`);
  }
}

async function editLink(b) {
  const v = await openEditor({ heading: "Edit link", title: b.title, url: b.url });
  if (v) await bm.update(b.id, v);
}

async function addLink(folderId) {
  const v = await openEditor({ heading: "Add link" });
  if (v) await bm.create({ parentId: folderId, ...v });
}

async function addFolder(parentId, heading, index) {
  const v = await openEditor({ heading, folder: true });
  if (v) await bm.create({ parentId, title: v.title, ...(index === undefined ? {} : { index }) });
}

async function renameFolder(f) {
  const v = await openEditor({ heading: "Rename", title: f.title, folder: true });
  if (v) await bm.update(f.id, { title: v.title });
}

async function deleteFolder(f) {
  const n = countLinks(f);
  if (n && !confirm(`Delete “${f.title}” and its ${n} link${n > 1 ? "s" : ""}?`)) return;
  await bm.removeTree(f.id);
  toast(`Deleted “${f.title}”`);
}

const countLinks = f => (f.children || []).reduce((n, c) => n + (c.url ? 1 : countLinks(c)), 0);

// ---------- drag & drop ----------

const DRAG_TYPE = "application/x-home-id";
const SECTION_TYPE = "application/x-home-section";
const isSectionDrag = e => e.dataTransfer.types.includes(SECTION_TYPE);

function clearDropMarks() {
  document.querySelectorAll(".drop-before, .drop-into, .drop-card, .drop-after, .drop-end").forEach(n =>
    n.classList.remove("drop-before", "drop-into", "drop-card", "drop-after", "drop-end"));
}

// Where a link drop lands: the link nearest the pointer (direct children of zone only),
// and whether it goes before or after it. Tiles compare on x, list rows on y.
function dropTarget(e, zone) {
  const links = [...zone.children].filter(n => n.matches("a[data-id]"));
  if (!links.length) return null;
  let best, bestDist = Infinity;
  for (const a of links) {
    const r = a.getBoundingClientRect();
    const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (d < bestDist) { best = a; bestDist = d; }
  }
  const r = best.getBoundingClientRect();
  const horizontal = best.classList.contains("fav");
  const after = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
  return { node: best, after, index: Number(best.dataset.index) + (after ? 1 : 0) };
}

function dropZone(zone, folderId) {
  zone.addEventListener("dragover", e => {
    if (isSectionDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    const t = dropTarget(e, zone);
    if (t) t.node.classList.add(t.after ? "drop-after" : "drop-before");
    else zone.classList.add("drop-into");
  });
  zone.addEventListener("dragleave", e => {
    if (!zone.contains(e.relatedTarget)) clearDropMarks();
  });
  zone.addEventListener("drop", e => {
    if (isSectionDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    handleDrop(e.dataTransfer, typeof folderId === "function" ? folderId() : folderId, dropTarget(e, zone)?.index);
  });
  return zone;
}

async function handleDrop(dt, parentId, index) {
  const dest = index === undefined ? { parentId } : { parentId, index };
  const id = dt.getData(DRAG_TYPE);
  if (id) {
    const [b] = await bm.get(id);
    // Dragging a section link onto Favorites pins a copy instead of moving it.
    if (parentId === state.fav.id && b.parentId !== state.fav.id) {
      if (!state.pinned.has(b.url)) await bm.create({ ...dest, title: b.title, url: b.url });
      return;
    }
    await bm.move(id, dest);
    return;
  }
  // Dropped from outside (address bar, another tab, a link on a page).
  const raw = dt.getData("text/uri-list") || dt.getData("text/plain");
  const url = raw.split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith("#"));
  if (url && /^https?:\/\//.test(url)) await bm.create({ ...dest, title: hostOf(url), url });
}

// ---------- rendering ----------

function linkNode(b, kind, parents) {
  const size = kind === "fav" ? 28 : 16;
  const a = el("a", {
    href: b.url, className: kind, title: b.url, draggable: true,
    dataset: { id: b.id, index: b.index },
  }, icon(b.url, size, b.title), el("span", { className: "label", textContent: b.title || hostOf(b.url) }));

  const acts = el("span", { className: "acts" });
  if (kind === "fav") {
    acts.append(actBtn("✎", "Edit", () => editLink(b)),
                actBtn("✕", "Unpin", () => removeLink(b, "Unpinned")));
  } else {
    const pinned = state.pinned.has(b.url);
    acts.append(actBtn(pinned ? "★" : "☆", pinned ? "Unpin from favorites" : "Pin to favorites",
                       () => togglePin(b), pinned ? "on" : ""),
                actBtn("✎", "Edit", () => editLink(b)),
                actBtn("✕", "Delete", () => removeLink(b, "Deleted")));
  }
  a.append(acts);

  a.addEventListener("dragstart", e => {
    e.dataTransfer.setData(DRAG_TYPE, b.id);
    e.dataTransfer.setData("text/uri-list", b.url);
    e.dataTransfer.effectAllowed = "copyMove";
  });
  allLinks.push({ node: a, text: `${b.title} ${b.url}`.toLowerCase(), parents });
  return a;
}

// virtual: not a real folder of its own (Pages) → add only.
// fixed: a folder the layout depends on (Bookmarks bar, Archive) → no rename/delete.
function folderActs(f, { section = false, virtual = false, fixed = false } = {}) {
  const acts = el("span", { className: "acts" }, actBtn("+", "Add link", () => addLink(f.id)));
  if (section && !virtual) acts.append(actBtn("⊞", "Add group", () => addFolder(f.id, "New group")));
  if (!virtual && !fixed) acts.append(actBtn("✎", "Rename", () => renameFolder(f)),
                                      actBtn("✕", "Delete", () => deleteFolder(f)));
  return acts;
}

function renderChildren(children, container, parents) {
  for (const c of children) {
    if (c.url) container.append(linkNode(c, "link", parents));
    else container.append(groupNode(c, parents));
  }
}

function groupNode(f, parents) {
  const d = el("details", { dataset: { id: f.id } });
  d.open = openGroups.has(f.id);
  d.addEventListener("toggle", () => {
    if (filtering) return;
    d.open ? openGroups.add(f.id) : openGroups.delete(f.id);
    saveOpenGroups();
  });
  const summary = dropZone(el("summary", {},
    el("span", { className: "label", textContent: f.title }),
    el("span", { className: "count", textContent: countLinks(f) }),
    folderActs(f)), f.id);
  const inner = dropZone(el("div", { className: "group" }), f.id);
  renderChildren(f.children || [], inner, [...parents, d]);
  d.append(summary, inner);
  return d;
}

function cardNode(f, opts = {}) {
  const card = el("div", { className: "card", dataset: { id: f.id } });
  const head = el("div", { className: "card-head", draggable: true, title: "Click to collapse · drag to move" },
    el("h2", { textContent: f.title }), folderActs(f, { section: true, ...opts }));
  const body = dropZone(el("div", { className: "body" }), f.id);
  renderChildren(f.children, body, [card]);
  if (!f.children.length) body.append(el("div", { className: "empty", textContent: "Drop links here or press +" }));
  card.append(head, body);

  head.addEventListener("click", e => {
    if (e.target.closest(".act")) return;
    layout.collapsed.has(f.id) ? layout.collapsed.delete(f.id) : layout.collapsed.add(f.id);
    card.classList.toggle("collapsed", layout.collapsed.has(f.id));
    saveLayout();
  });
  head.addEventListener("dragstart", e => {
    e.dataTransfer.setData(SECTION_TYPE, f.id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  head.addEventListener("dragend", () => { card.classList.remove("dragging"); clearDropMarks(); });
  card.classList.toggle("collapsed", layout.collapsed.has(f.id));
  return card;
}

// A column accepts section drops: before the card whose vertical middle is below the
// pointer, else at the end.
function cardAfterPointer(col, y) {
  return [...col.querySelectorAll(":scope > .card:not(.dragging)")]
    .find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
}

function columnNode(index) {
  const col = el("div", { className: "col", dataset: { col: index } });
  col.addEventListener("dragover", e => {
    if (!isSectionDrag(e)) return;
    e.preventDefault();
    clearDropMarks();
    const after = cardAfterPointer(col, e.clientY);
    const last = [...col.querySelectorAll(":scope > .card:not(.dragging)")].pop();
    if (after) after.classList.add("drop-card");
    else if (last) last.classList.add("drop-after");
    else col.classList.add("drop-end");
  });
  col.addEventListener("dragleave", e => { if (!col.contains(e.relatedTarget)) clearDropMarks(); });
  col.addEventListener("drop", e => {
    if (!isSectionDrag(e)) return;
    e.preventDefault();
    clearDropMarks();
    const after = cardAfterPointer(col, e.clientY);
    moveSection(e.dataTransfer.getData(SECTION_TYPE), index, after?.dataset.id);
  });
  return col;
}

async function load() {
  const { bar, other, fav, archive } = await loadLayout();
  const [[otherTree], [barTree]] = await Promise.all([bm.getSubTree(other.id), bm.getSubTree(bar.id)]);
  const favNode = otherTree.children.find(c => c.id === fav.id);
  const seen = new Set();
  const dupes = favNode.children.filter(c => c.url && (seen.has(c.url) || !seen.add(c.url)));
  if (dupes.length) { for (const d of dupes) await bm.remove(d.id); return; } // removal re-triggers load
  Object.assign(state, { bar, other, fav, archive });
  state.pinned = new Set(favNode.children.filter(c => c.url).map(c => c.url));
  allLinks = [];

  const favs = $("#favorites");
  favs.replaceChildren();
  // #favorites survives re-renders, so attach its drop handlers only once.
  if (!favs.dataset.zone) { dropZone(favs, () => state.fav.id); favs.dataset.zone = "1"; }
  for (const c of favNode.children) if (c.url) favs.append(linkNode(c, "fav", []));
  if (!state.pinned.size) favs.append(el("div", { className: "empty", textContent: "Pin links with ☆ or drag them here" }));

  // Every section, in bookmark order: [folderNode, cardOptions]
  const list = [];
  const loose = otherTree.children.filter(c => c.url);
  if (loose.length) list.push([{ id: other.id, title: "Pages", children: loose }, { virtual: true }]);
  if (barTree.children.length) list.push([{ ...barTree, title: "Bookmarks bar" }, { fixed: true }]);
  for (const c of otherTree.children) {
    if (isFolder(c) && c.id !== fav.id && c.id !== archive?.id) list.push([c, {}]);
  }
  const archiveNode = archive && otherTree.children.find(c => c.id === archive.id);
  if (archiveNode) list.push([archiveNode, { fixed: true }]);

  await loadSavedLayout();
  placeNewSections(list.map(([f]) => f), archive?.id);

  const cards = new Map(list.map(([f, opts]) => [f.id, cardNode(f, opts)]));
  const sections = $("#sections");
  sections.style.setProperty("--cols", layout.columns);
  sections.replaceChildren(...layout.cols.map((ids, i) => {
    const col = columnNode(i);
    for (const id of ids) if (cards.has(id)) col.append(cards.get(id));
    return col;
  }));
  $("#col-count").textContent = layout.columns;

  applyFilter();
}

// Our own edits fire these too, so this is the only re-render path.
let reloadTimer;
const scheduleLoad = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => load().catch(e => showError(String(e?.message || e))), 50); };
if (bm) {
  for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"]) {
    bm[ev].addListener(scheduleLoad);
  }
}

function showError(msg) {
  $("#sections").replaceChildren(el("div", { className: "card error" }, el("h2", { textContent: "Can't load bookmarks" }),
    el("div", { className: "empty", textContent: msg })));
}

// ---------- clock ----------

function tick() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("#date").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

// ---------- search / filter ----------

const input = $("#search");
let matches = [];
let selected = 0;
let filtering = false;

function parseShortcut(q) {
  const m = q.match(/^(\S+)\s+(.+)$/);
  return m && SEARCH[m[1]] ? { engine: SEARCH[m[1]], query: m[2] } : null;
}

function setSelected(i) {
  matches.forEach(m => m.node.classList.remove("sel"));
  selected = i;
  if (matches[i]) {
    matches[i].node.classList.add("sel");
    matches[i].node.scrollIntoView({ block: "nearest" });
  }
}

function applyFilter() {
  const q = input.value.trim();
  const sc = parseShortcut(q);
  filtering = Boolean(q && !sc);

  document.querySelectorAll(".card, details").forEach(n => n.classList.remove("hidden"));
  document.querySelectorAll("#sections .card").forEach(c =>
    c.classList.toggle("collapsed", !filtering && layout.collapsed.has(c.dataset.id)));
  allLinks.forEach(l => l.node.classList.remove("hidden", "sel"));
  matches = [];

  if (filtering) {
    const terms = q.toLowerCase().split(/\s+/);
    const visible = new Set();
    for (const l of allLinks) {
      const hit = terms.every(t => l.text.includes(t));
      l.node.classList.toggle("hidden", !hit);
      if (hit) { matches.push(l); l.parents.forEach(p => visible.add(p)); }
    }
    document.querySelectorAll(".card, details").forEach(n => {
      n.classList.toggle("hidden", !visible.has(n));
      if (n.tagName === "DETAILS") n.open = visible.has(n);
    });
    setSelected(0);
  } else {
    document.querySelectorAll("details").forEach(d => (d.open = openGroups.has(d.dataset.id)));
  }

  const h = $("#hint");
  if (sc) {
    h.replaceChildren("Enter to search ", el("b", { textContent: sc.engine.name }), ` for “${sc.query}”`);
  } else if (filtering) {
    h.textContent = matches.length
      ? `${matches.length} match${matches.length > 1 ? "es" : ""} · ↑↓ move · Enter open · ⌘Enter new tab`
      : "No links match. Enter to search Google.";
  } else {
    h.textContent = Object.entries(SEARCH).map(([k, v]) => `${k} ${v.name.toLowerCase()}`).join(" · ") + " · / to focus";
  }
}

function go(url, newTab) {
  if (newTab) window.open(url, "_blank");
  else location.href = url;
}

input.addEventListener("input", applyFilter);
input.addEventListener("keydown", e => {
  const q = input.value.trim();
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!matches.length) return;
    e.preventDefault();
    const d = e.key === "ArrowDown" ? 1 : -1;
    setSelected((selected + d + matches.length) % matches.length);
  } else if (e.key === "Enter" && q) {
    e.preventDefault();
    const newTab = e.metaKey || e.ctrlKey;
    const sc = parseShortcut(q);
    if (sc) return go(sc.engine.url.replace("%s", encodeURIComponent(sc.query)), newTab);
    if (matches[selected]) return go(matches[selected].node.href, newTab);
    go(SEARCH.g.url.replace("%s", encodeURIComponent(q)), newTab);
  } else if (e.key === "Escape") {
    input.value = "";
    applyFilter();
  }
});
document.addEventListener("keydown", e => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (e.key === "/" && !typing && !editor.open) { e.preventDefault(); input.focus(); }
});

$("#col-minus").addEventListener("click", () => setColumns(layout.columns - 1));
$("#col-plus").addEventListener("click", () => setColumns(layout.columns + 1));
$("#add-section").addEventListener("click", () => addFolder(state.other.id, "New section", state.archive?.index));
$("#manage").addEventListener("click", e => {
  e.preventDefault();
  chrome.tabs.create({ url: `chrome://bookmarks/?id=${state.other.id}` });
});

tick();
setInterval(tick, 10_000);
if (!bm) showError("The extension doesn't have bookmarks permission yet. Open chrome://extensions and click the reload icon on Home.");
else load().catch(e => showError(String(e?.message || e)));

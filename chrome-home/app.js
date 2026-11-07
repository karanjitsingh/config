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
// ---------- saved layout ----------
// Kept in chrome.storage.local (bookmark IDs are per-machine, so this isn't synced).
//   columns:   number of columns
//   cols:      section ids per column, top to bottom (ids not currently present are kept
//              so a section that disappears and comes back returns to its spot)
//   collapsed: section ids that are collapsed
//   open:      group (sub-folder) ids that are expanded
//   sizes:     { cardId: { span, height } } for resizable widgets (columns wide, body px)
//   version:   2 = cols lists exactly the cards on the page. Before that every top-level
//              folder showed automatically (plus v1's `widgets`/`hidden` lists).
// Cards are bookmark folder ids or "widget:<id>". Nothing appears on its own: folders and
// widgets are added from "+ Add to page" and removed with ✕ (the folder stays in bookmarks).
const LAYOUT_KEY = "layout";
const LAYOUT_VERSION = 2;
const MAX_COLS = 5;
const layout = { columns: 3, cols: [[], [], []], collapsed: new Set(), open: new Set(), sizes: {}, version: 0, legacy: null, loaded: false };
const openGroups = layout.open;

async function loadSavedLayout() {
  if (layout.loaded) return;
  const { [LAYOUT_KEY]: saved } = await chrome.storage.local.get(LAYOUT_KEY);
  if (saved) {
    layout.columns = saved.columns;
    layout.cols = saved.cols;
    saved.collapsed.forEach(id => layout.collapsed.add(id));
    saved.open.forEach(id => layout.open.add(id));
    layout.version = saved.version || 1;
    layout.sizes = saved.sizes || {};
    layout.legacy = { widgets: saved.widgets || [], hidden: saved.hidden || [] };
  } else {
    JSON.parse(localStorage.openGroups || "[]").forEach(id => layout.open.add(id)); // from v3
  }
  layout.loaded = true;
}

function saveLayout() {
  return chrome.storage.local.set({ [LAYOUT_KEY]: {
    version: LAYOUT_VERSION, columns: layout.columns, cols: layout.cols,
    collapsed: [...layout.collapsed], open: [...layout.open], sizes: layout.sizes,
  } });
}
const saveOpenGroups = saveLayout;

function fitColumns() {
  while (layout.cols.length < layout.columns) layout.cols.push([]);
  while (layout.cols.length > layout.columns) layout.cols[layout.cols.length - 2].push(...layout.cols.pop());
}

// First run / upgrade only: lay out the default set of sections. Each goes to the column
// with the least content (by row count, so it's deterministic); Archive goes last and
// starts collapsed.
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
  document.body.classList.remove("dragging-section"); // the dragged node is re-rendered, so dragend may not fire
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
function openEditor({ heading, title = "", url = "", emoji = "", folder = false }) {
  const f = editor.querySelector("form");
  const fTitle = f.elements.namedItem("title");
  const fUrl = f.elements.namedItem("url");
  const fEmoji = f.elements.namedItem("emoji");
  $("#ed-heading").textContent = heading;
  fTitle.value = title;
  fUrl.value = url;
  fEmoji.value = emoji;
  $("#ed-url-row").classList.toggle("hidden", folder);
  $("#ed-emoji-row").classList.toggle("hidden", folder);
  editor.returnValue = "";
  editor.showModal();
  (folder || title ? fTitle : fUrl).select();
  return new Promise(resolve => {
    editor.addEventListener("close", () => {
      if (editor.returnValue !== "ok") return resolve(null);
      const t = fTitle.value.trim();
      const u = normalizeUrl(fUrl.value);
      if (folder ? !t : !u) return resolve(null);
      const name = t || hostOf(u);
      const e = folder ? "" : firstEmoji(fEmoji.value);
      resolve({ title: e ? `${e} ${name}` : name, url: u });
    }, { once: true });
  });
}

// Every dialog closes on a click outside it, like Esc. Both press and release must land
// outside, so a text selection that ends past the edge doesn't close it.
for (const dlg of document.querySelectorAll("dialog")) {
  const outside = e => {
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOutside = false;
  dlg.addEventListener("mousedown", e => { downOutside = e.target === dlg && outside(e); });
  dlg.addEventListener("click", e => {
    if (downOutside && e.target === dlg && outside(e)) dlg.close();
    downOutside = false;
  });
}

// ---------- context menu ----------
const menu = el("div", { id: "ctxmenu", className: "hidden", role: "menu", tabIndex: -1 });
document.body.append(menu);
const hideMenu = () => menu.classList.add("hidden");

function showMenu(x, y, items) {
  menu.replaceChildren(...items.map(([label, fn, cls = ""]) => {
    const b = el("button", { type: "button", className: cls, textContent: label, role: "menuitem" });
    b.addEventListener("click", () => { hideMenu(); fn(); });
    return b;
  }));
  menu.classList.remove("hidden");
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  menu.focus(); // nothing preselected; ↑/↓ start moving through the items
}
menu.addEventListener("keydown", e => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...menu.querySelectorAll("button")];
  const i = items.indexOf(document.activeElement);
  const next = i === -1 ? (e.key === "ArrowDown" ? 0 : items.length - 1)
    : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next].focus();
});
document.addEventListener("mousedown", e => { if (!menu.contains(e.target)) hideMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") hideMenu(); });
addEventListener("blur", hideMenu);
addEventListener("scroll", hideMenu, true);
addEventListener("resize", hideMenu);

// Slides up from the bottom, fades out on its own (longer when there's an Undo), and
// stays while hovered. A new toast replaces the current one in place.
let toastTimer;
function toast(msg, undo) {
  const t = $("#toast");
  const hide = () => t.classList.remove("show");
  const arm = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hide, undo ? 6000 : 2800); };
  t.querySelector("span").textContent = msg;
  t.classList.toggle("error", /^couldn't|failed|error/i.test(msg));
  const b = t.querySelector("button");
  b.classList.toggle("hidden", !undo);
  b.onclick = async () => { hide(); await undo(); };
  t.onmouseenter = () => clearTimeout(toastTimer);
  t.onmouseleave = arm;
  if (t.classList.contains("show")) { t.classList.remove("bump"); void t.offsetWidth; t.classList.add("bump"); }
  t.classList.add("show");
  arm();
}

// ---------- bookmark actions ----------

async function removeLink(b, msg) {
  await bm.remove(b.id);
  toast(`${msg} “${splitIcon(b.title).name}”`, () =>
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
  const { emoji, name } = splitIcon(b.title);
  const v = await openEditor({ heading: "Edit link", title: name, url: b.url, emoji });
  if (v) await bm.update(b.id, v);
}

async function addLink(folderId, heading = "Add link") {
  const v = await openEditor({ heading });
  if (v) await bm.create({ parentId: folderId, ...v });
}

async function addFolder(parentId, heading, index) {
  const v = await openEditor({ heading, folder: true });
  return v && bm.create({ parentId, title: v.title, ...(index === undefined ? {} : { index }) });
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
  dropGhost.remove();
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
  const { emoji, name } = splitIcon(b.title);
  const ico = emoji
    ? el("i", { className: "emoji", style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.9)}px`, textContent: emoji })
    : icon(b.url, size, name);
  const a = el("a", {
    href: b.url, className: kind, title: b.url, draggable: true,
    dataset: { id: b.id, index: b.index },
  }, ico, el("span", { className: "label", textContent: name || hostOf(b.url) }));

  const acts = el("span", { className: "acts" });
  if (kind === "fav") {
    // Tiles stay clean: actions live in a right-click menu instead of hover buttons.
    a.addEventListener("contextmenu", e => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        ["Open in new tab", () => window.open(b.url, "_blank")],
        ["Edit", () => editLink(b)],
        ["Unpin", () => removeLink(b, "Unpinned"), "danger"],
      ]);
    });
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
  return a;
}

// virtual: not a real folder of its own (Pages) → add only.
// fixed: a folder the layout depends on (Bookmarks bar, Archive) → no rename/delete.
// Sections get "remove from page" instead of delete: the folder and its links stay in
// bookmarks and can be added back from "+ Add to page". Groups inside a section can
// still be deleted.
function folderActs(f, { section = false, virtual = false, fixed = false } = {}) {
  const acts = el("span", { className: "acts" }, actBtn("+", "Add link", () => addLink(f.id)));
  if (section && !virtual) acts.append(actBtn("⊞", "Add group", () => addFolder(f.id, "New group")));
  if (!virtual && !fixed) acts.append(actBtn("✎", "Rename", () => renameFolder(f)));
  if (section) acts.append(actBtn("✕", "Remove from page", () => removeCard(f.id, f.title)));
  else if (!virtual && !fixed) acts.append(actBtn("✕", "Delete", () => deleteFolder(f)));
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
  const body = dropZone(el("div", { className: "body" }), f.id);
  const card = cardShell(f.id, [el("h2", { textContent: f.title })], folderActs(f, { section: true, ...opts }), body);
  renderChildren(f.children, body, [card]);
  if (!f.children.length) body.append(el("div", { className: "empty", textContent: "Drop links here or press +" }));
  return card;
}

// A widget card: same header behaviour as a section, body owned by widgets.js.
function widgetCard(def) {
  const id = widgetKey(def.id);
  const ui = widgetBody(def);
  const acts = el("span", { className: "acts" }, actBtn("↻", "Refresh", () => refreshWidget(def, true)));
  if (def.link) acts.append(actBtn("↗", "Open", () => window.open(def.link, "_blank")));
  acts.append(actBtn("✕", "Remove from page", () => removeCard(id, def.title)));
  const card = cardShell(id, [el("h2", { textContent: def.title }, ui.count)], acts, ui.body, "widget");
  const size = layout.sizes[id] || {};
  ui.body.style.height = size.height ? `${size.height}px` : "";
  ui.body.classList.toggle("sized", !!size.height);
  if (def.resizable) card.append(resizeGrip(card, id, ui.body));
  return card;
}

// Bottom-right grip: drag sideways to span more columns, down/up to set the height.
// Double-click goes back to the natural size.
function resizeGrip(card, id, body) {
  const grip = el("div", { className: "grip", title: "Drag to resize · double-click to reset" });
  grip.addEventListener("pointerdown", e => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const { colW, gap, n } = columnMetrics();
    const col = Number(card.parentElement.dataset.col);
    const left = card.getBoundingClientRect().left;
    const bodyTop = body.getBoundingClientRect().top;
    card.classList.add("resizing");
    const move = ev => {
      const span = Math.max(1, Math.min(n - col, Math.round((ev.clientX - left + gap) / (colW + gap))));
      const height = Math.max(80, Math.round((ev.clientY - bodyTop) / 10) * 10);
      layout.sizes[id] = { span, height };
      body.style.height = `${height}px`;
      body.classList.add("sized");
      arrange();
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      card.classList.remove("resizing");
      saveLayout();
      saveSnapshot();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
  });
  grip.addEventListener("dblclick", () => {
    delete layout.sizes[id];
    body.style.height = "";
    body.classList.remove("sized");
    saveLayout();
    arrange();
  });
  return grip;
}

// Collapsible, draggable section card around any body.
function cardShell(id, title, acts, body, extraClass = "") {
  const card = el("div", { className: `card ${extraClass}`.trim(), dataset: { id } });
  const head = el("div", { className: "card-head", draggable: true, title: "Click to collapse · drag to move" },
    ...title, acts);
  card.append(head, body);

  head.addEventListener("click", e => {
    if (e.target.closest(".act")) return;
    layout.collapsed.has(id) ? layout.collapsed.delete(id) : layout.collapsed.add(id);
    card.classList.toggle("collapsed", layout.collapsed.has(id));
    saveLayout();
  });
  head.addEventListener("dragstart", e => {
    draggingCard = card;
    e.dataTransfer.setData(SECTION_TYPE, id);
    setTimeout(() => card.classList.add("drag-through")); // after the drag starts: let the pointer reach what's beneath
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
    document.body.classList.add("dragging-section");
  });
  head.addEventListener("dragend", () => {
    draggingCard = null;
    card.classList.remove("dragging", "drag-through");
    document.body.classList.remove("dragging-section");
    clearDropMarks();
  });
  card.classList.toggle("collapsed", layout.collapsed.has(id));
  return card;
}

// ---------- cards on the page ----------

const onPage = id => layout.cols.some(c => c.includes(id));

// Rough height of a card, to pick the emptiest column for a new one.
function cardWeight(id) {
  if (isWidgetKey(id)) return 6;
  const n = state.nodes?.get(id);
  return 2 + (n?.children || []).length;
}

function placeCard(id) {
  if (onPage(id)) return;
  fitColumns();
  const weight = col => col.reduce((n, c) => n + cardWeight(c), 0);
  const col = layout.cols.reduce((a, b) => (weight(b) < weight(a) ? b : a));
  const ai = col.indexOf(state.archive?.id);
  ai === -1 ? col.push(id) : col.splice(ai, 0, id); // keep Archive at the bottom
  layout.collapsed.delete(id);
  saveLayout();
  load();
}

function removeCard(id, title) {
  const ci = layout.cols.findIndex(c => c.includes(id));
  if (ci === -1) return;
  const i = layout.cols[ci].indexOf(id);
  layout.cols[ci].splice(i, 1);
  saveLayout();
  load();
  toast(`Removed “${title}” from the page`, () => {
    if (onPage(id)) return;
    layout.cols[Math.min(ci, layout.cols.length - 1)].splice(i, 0, id);
    saveLayout();
    load();
  });
}

function addWidget(def) {
  // Ask for host access right away, while we still have the click's user gesture.
  if (def.origins?.length) chrome.permissions.request({ origins: def.origins }, () => refreshWidget(def, true));
  placeCard(widgetKey(def.id));
}

// "+ Add to page": every bookmark folder and widget, each with Add / Remove. Stays open so
// you can add several; the page updates behind it.
const addDlg = $("#add-dlg");

const ICONS = {
  folder: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  widget: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>',
};
const svgNode = (markup, className) => { const n = el("span", { className }); n.innerHTML = markup; return n; }; // static markup only

// Add / Added toggle for a widget.
function toggleButton(id, add, title) {
  const b = el("button", { type: "button", className: "pill" });
  const sync = () => {
    const on = onPage(id);
    b.textContent = on ? "Added" : "Add";
    b.classList.toggle("on", on);
    b.title = on ? "Remove from page" : "Add to page";
  };
  b.addEventListener("click", () => { onPage(id) ? removeCard(id, title) : add(); sync(); });
  sync();
  return b;
}

function galleryItem({ icon, title, desc, action }) {
  return el("div", { className: "wg-item" },
    svgNode(icon, "wg-ico"),
    el("div", { className: "wg-text" },
      el("div", { className: "wg-title", textContent: title }),
      desc ? el("div", { className: "wg-desc", textContent: desc }) : ""),
    action);
}

function openAddDialog() {
  const folder = galleryItem({ icon: ICONS.folder, title: "Bookmarks folder",
    desc: "Links from one of your bookmark folders.", action: svgNode(ICONS.chevron, "wg-go") });
  folder.classList.add("clickable");
  folder.tabIndex = 0;
  folder.addEventListener("click", showFolderPicker);
  folder.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showFolderPicker(); } });
  const widgets = [...WIDGETS.values()].map(d => galleryItem({ icon: d.icon || ICONS.widget, title: d.title,
    desc: d.description, action: toggleButton(widgetKey(d.id), () => addWidget(d), d.title) }));
  $("#wg-list").replaceChildren(folder, ...widgets);
  showAddView("main");
  addDlg.showModal();
  folder.focus();
}

function showAddView(view) {
  $("#add-main").classList.toggle("hidden", view !== "main");
  $("#add-pick").classList.toggle("hidden", view !== "pick");
}

// Step 2 of "Bookmarks folder": pick which folder. Folders already on the page are marked.
function showFolderPicker() {
  const rows = [];
  const row = (id, title, count, depth, path) => {
    const on = onPage(id);
    const b = el("button", { type: "button", className: "fp-row", disabled: on, style: `--depth:${depth}`, dataset: { path: path.toLowerCase() } },
      svgNode(ICONS.folder, "fp-ico"),
      el("span", { className: "fp-name", textContent: title }),
      el("span", { className: on ? "fp-badge" : "fp-count", textContent: on ? "On page" : count }));
    b.addEventListener("click", () => { placeCard(id); addDlg.close(); });
    rows.push(b);
  };
  const walk = (f, depth, path) => {
    for (const c of f.children || []) {
      if (!isFolder(c) || c.id === state.fav?.id) continue;
      row(c.id, c.title, countLinks(c), depth, `${path} ${c.title}`);
      walk(c, depth + 1, `${path} ${c.title}`);
    }
  };
  for (const r of state.root?.children || []) {
    if (r.id === state.other?.id) {
      const n = (r.children || []).filter(c => c.url).length;
      if (n) row(r.id, "Pages", n, 0, "pages");
      walk(r, 0, ""); // Other bookmarks' folders are top level
    } else if ((r.children || []).length) {
      const name = r.id === state.bar?.id ? "Bookmarks bar" : r.title;
      row(r.id, name, countLinks(r), 0, name);
      walk(r, 1, name);
    }
  }
  $("#af-list").replaceChildren(...(rows.length ? rows : [el("div", { className: "empty", textContent: "No bookmark folders yet." })]));
  const filter = $("#af-filter");
  filter.value = "";
  filter.oninput = () => {
    const q = filter.value.trim().toLowerCase();
    for (const r of rows) r.classList.toggle("hidden", !!q && !r.dataset.path.includes(q));
  };
  filter.onkeydown = e => {
    if (e.key === "Enter") { e.preventDefault(); rows.find(r => !r.disabled && !r.classList.contains("hidden"))?.click(); }
  };
  showAddView("pick");
  filter.focus();
}

// A column accepts section drops: before the card whose vertical middle is below the
// pointer, else at the end.
function cardAfterPointer(col, y) {
  return [...col.querySelectorAll(":scope > .card:not(.dragging)")]
    .find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
}

// While a card is dragged, a dashed outline shows exactly where it would land: its own
// width (a wide widget covers several columns) and height, at the spot arrange() would
// put it.
let draggingCard = null;
const dropGhost = el("div", { className: "drop-ghost" });

function showDropGhost(colIndex, beforeCard) {
  const { sec, n, gap, colW } = columnMetrics();
  const lane = n === 1 ? 0 : Math.min(colIndex, n - 1);
  const id = draggingCard?.dataset.id;
  const span = n === 1 ? 1 : Math.max(1, Math.min(layout.sizes[id]?.span || 1, n - lane));
  const left = lane * (colW + gap);
  const width = span * colW + (span - 1) * gap;
  const height = Math.max(48, draggingCard?.offsetHeight || 80);
  let top = 0;
  if (beforeCard) top = parseFloat(beforeCard.style.top) || 0;
  else {
    // Below everything already in the columns it would cover.
    for (const c of sec.querySelectorAll(".col > .card:not(.dragging)")) {
      const cl = (parseFloat(c.parentElement.style.left) || 0) + c.offsetLeft;
      if (cl < left + width - 1 && cl + c.offsetWidth > left + 1) {
        top = Math.max(top, (parseFloat(c.style.top) || 0) + c.offsetHeight + gap);
      }
    }
  }
  Object.assign(dropGhost.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  if (!dropGhost.isConnected) sec.append(dropGhost);
}

function columnNode(index) {
  return el("div", { className: "col", dataset: { col: index } });
}

// Which column a card drop lands in comes from the pointer's x position, not from the
// element under it: a wide card belongs to its first column but covers others, and the
// dragged card itself would otherwise swallow the pointer.
function dropSlot(e) {
  const { sec, n, gap, colW } = columnMetrics();
  const cols = [...sec.querySelectorAll(":scope > .col")];
  let ci;
  if (n === 1) ci = Math.max(0, cols.indexOf(e.target.closest?.(".col"))); // stacked: use the column under the pointer
  else ci = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - sec.getBoundingClientRect().left + gap / 2) / (colW + gap))));
  return { ci, before: cols[ci] && cardAfterPointer(cols[ci], e.clientY) };
}

const sectionsEl = $("#sections");
sectionsEl.addEventListener("dragover", e => {
  if (!isSectionDrag(e)) return;
  e.preventDefault();
  const { ci, before } = dropSlot(e);
  showDropGhost(ci, before);
});
sectionsEl.addEventListener("dragleave", e => { if (!sectionsEl.contains(e.relatedTarget)) clearDropMarks(); });
sectionsEl.addEventListener("drop", e => {
  if (!isSectionDrag(e)) return;
  e.preventDefault();
  clearDropMarks();
  const { ci, before } = dropSlot(e);
  moveSection(e.dataTransfer.getData(SECTION_TYPE), ci, before?.dataset.id);
});

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

// ---------- column layout ----------
// Cards are positioned by hand (a small masonry) so a resized widget can span several
// columns. Each column is still its own element holding its cards, which keeps drag and
// drop and the saved order simple; arrange() only sets positions. Cards are placed row by
// row across the columns, and a wide card starts below everything in the columns it covers.
const GAP = 18;

function columnMetrics() {
  const sec = $("#sections");
  const n = matchMedia("(max-width: 760px)").matches ? 1 : layout.columns;
  const W = sec.clientWidth;
  return { sec, n, W, gap: GAP, colW: (W - GAP * (n - 1)) / n };
}

function arrange() {
  const { sec, n, W, gap, colW } = columnMetrics();
  const cols = [...sec.querySelectorAll(":scope > .col")];
  if (!cols.length || !W) return;
  const single = n === 1;
  const queues = cols.map(c => [...c.querySelectorAll(":scope > .card")]);
  const bottoms = new Array(n).fill(0);
  cols.forEach((c, i) => {
    c.style.left = `${single ? 0 : i * (colW + gap)}px`;
    c.style.width = `${single ? W : colW}px`;
  });
  const place = (card, c) => {
    const span = single ? 1 : Math.max(1, Math.min(layout.sizes[card.dataset.id]?.span || 1, n - c));
    const lane = single ? 0 : c;
    const top = Math.max(...bottoms.slice(lane, lane + span));
    card.style.width = `${span * colW + (span - 1) * gap}px`;
    card.style.top = `${top}px`;
    const h = card.offsetHeight;
    for (let k = lane; k < lane + span; k++) bottoms[k] = top + h + gap;
  };
  if (single) queues.forEach((q, c) => q.forEach(card => place(card, c)));
  else {
    for (let row = 0; queues.some(q => q.length > row); row++) {
      queues.forEach((q, c) => { if (q[row]) place(q[row], c); });
    }
  }
  sec.style.height = `${Math.max(0, ...bottoms.map(b => b - gap))}px`;
}

// Re-run when anything changes size: content loading, collapsing, the window.
let arrangeQueued = false;
const queueArrange = () => {
  if (arrangeQueued) return;
  arrangeQueued = true;
  requestAnimationFrame(() => { arrangeQueued = false; arrange(); });
};
const cardObserver = new ResizeObserver(queueArrange);
function observeCards() {
  cardObserver.disconnect();
  cardObserver.observe($("#sections"));
  document.querySelectorAll("#sections .card").forEach(c => cardObserver.observe(c));
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
const scheduleLoad = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => load().catch(e => showError(String(e?.message || e))), 50); };
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

// ---------- peek (Arc-style) ----------
// A plain click on a link on the page opens it in an overlay on the homepage instead of
// navigating away. ⌘/Ctrl/Shift/middle-click still behave normally; Settings → "Open
// links in peek" turns it off.
//
// Most sites forbid being shown inside another page (X-Frame-Options / CSP
// frame-ancestors). A session rule removes those headers, but only for frames loaded in
// this tab, so nothing changes for normal browsing.
// Per kind of link: "fav", "link" (bookmark cards), or "widget:<id>". All on by default.
function peekKind(a) {
  if (a.classList.contains("fav")) return "fav";
  if (a.classList.contains("link")) return "link";
  const w = a.closest(".card.widget")?.dataset.id;
  return w || "other";
}
function peekOn(kind) {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.peekKinds || "{}"); } catch { /* reset below */ }
  if (localStorage.peek === "off") return false; // older all-or-nothing switch
  return cfg[kind] !== false;
}
const PEEK_ORIGINS = ["https://*/*", "http://*/*"];
let peekRuleId = null;

async function allowFramingInThisTab() {
  if (peekRuleId !== null) return true;
  if (!chrome.declarativeNetRequest) return false;
  const tab = await new Promise(r => chrome.tabs.getCurrent(r));
  if (!tab) return false;
  peekRuleId = 1000 + (tab.id % 100000);
  const action = {
    type: "modifyHeaders",
    responseHeaders: [
      { header: "x-frame-options", operation: "remove" },
      { header: "content-security-policy", operation: "remove" },
    ],
  };
  // Two ways to recognize peek frames: by this tab, and by the extension having started
  // the frame's navigation (frames inside extension pages aren't always tied to a tab id).
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [peekRuleId, 1],
    addRules: [
      { id: peekRuleId, priority: 1, action, condition: { resourceTypes: ["sub_frame"], tabIds: [tab.id] } },
      { id: 1, priority: 1, action, condition: { resourceTypes: ["sub_frame"], initiatorDomains: [chrome.runtime.id] } },
    ],
  });
  return true;
}
addEventListener("pagehide", () => {
  if (peekRuleId !== null) chrome.declarativeNetRequest?.updateSessionRules({ removeRuleIds: [peekRuleId] });
});

const peek = {
  root: null, frame: null, title: null, host: null, icon: null, hint: null, url: "", hintTimer: 0,
  build() {
    if (this.root) return;
    const close = el("button", { type: "button", className: "peek-btn", title: "Close (Esc)", textContent: "✕" });
    // "Expand": open the page right here, replacing the homepage in this tab.
    const toTab = el("button", { type: "button", className: "peek-btn wide", title: "Open this page in this tab (⌘O)" },
      el("span", { textContent: "Expand" }), el("kbd", { className: "peek-kbd", textContent: "⌘O" }));
    this.icon = el("img", { className: "peek-ico", alt: "", width: 16, height: 16 });
    this.title = el("span", { className: "peek-title" });
    this.host = el("span", { className: "peek-host" });
    this.frame = el("iframe", { className: "peek-frame", referrerPolicy: "no-referrer-when-downgrade" });
    // No sandbox: a sandboxed frame loses service workers and some storage, which apps
    // like Gmail need. Chrome itself stops a cross-site frame from navigating the
    // homepage away unless you clicked inside it.
    this.frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen; camera; microphone; display-capture; storage-access");
    this.hint = el("div", { className: "peek-hint hidden" },
      el("span", { textContent: "Not loading? Some sites don't allow being shown here." }),
      el("button", { type: "button", className: "peek-btn wide", onclick: () => this.toTab() },
        el("span", { textContent: "Expand" }), el("kbd", { className: "peek-kbd", textContent: "⌘O" })));
    const panel = el("div", { className: "peek-panel" },
      el("div", { className: "peek-bar" }, this.icon, this.title, this.host, el("span", { className: "peek-gap" }), toTab, close),
      el("div", { className: "peek-body" }, this.frame, this.hint));
    this.root = el("div", { className: "peek-backdrop hidden" }, panel);
    this.root.addEventListener("mousedown", e => { if (e.target === this.root) this.close(); });
    close.addEventListener("click", () => this.close());
    toTab.addEventListener("click", () => this.toTab());
    this.frame.addEventListener("load", () => {
      this.root.classList.remove("loading");
      clearTimeout(this.hintTimer);
    });
    document.addEventListener("keydown", e => {
      if (!this.isOpen()) return;
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === "o" || e.key === "O" || e.key === "Enter")) { e.preventDefault(); this.toTab(); }
    });
    document.body.append(this.root);
  },
  isOpen() { return this.root && !this.root.classList.contains("hidden"); },
  // Grow out of the clicked link and shrink back into it (falls back to a plain zoom).
  fromRect: null,
  zoom(reverse) {
    const panel = this.root.querySelector(".peek-panel");
    const p = panel.getBoundingClientRect();
    const r = this.fromRect;
    const start = r
      ? `translate(${r.left + r.width / 2 - (p.left + p.width / 2)}px, ${r.top + r.height / 2 - (p.top + p.height / 2)}px) scale(${Math.max(0.08, r.width / p.width)}, ${Math.max(0.04, r.height / p.height)})`
      : "translateY(16px) scale(.96)";
    const frames = [{ transform: start, opacity: 0, borderRadius: "28px" }, { transform: "none", opacity: 1, borderRadius: "16px" }];
    const opts = { duration: reverse ? 200 : 300, easing: reverse ? "cubic-bezier(.4, 0, .9, .4)" : "cubic-bezier(.2, .9, .25, 1.05)", fill: "both" };
    const anim = panel.animate(reverse ? frames.reverse() : frames, opts);
    this.root.animate([{ opacity: reverse ? 1 : 0 }, { opacity: reverse ? 0 : 1 }], { duration: opts.duration, fill: "both" });
    return anim.finished.catch(() => {});
  },
  open(url, label, fromRect) {
    this.build();
    this.fromRect = fromRect || null;
    this.url = url;
    this.title.textContent = label || hostOf(url);
    this.host.textContent = label ? hostOf(url) : "";
    this.icon.src = favicon(url, 32);
    this.hint.classList.add("hidden");
    this.root.classList.add("loading");
    this.frame.src = url;
    this.root.classList.remove("hidden");
    document.body.classList.add("peeking");
    this.root.querySelector(".peek-btn.wide").focus(); // keys go to the homepage (Esc, ⌘O) until you click into the page
    this.zoom(false);
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.classList.remove("hidden"), 5000);
  },
  async close() {
    if (!this.isOpen() || this.closing) return;
    this.closing = true;
    clearTimeout(this.hintTimer);
    await this.zoom(true);
    this.root.classList.add("hidden");
    for (const a of [...this.root.getAnimations({ subtree: true })]) a.cancel();
    document.body.classList.remove("peeking");
    this.frame.src = "about:blank";
    this.closing = false;
  },
  toTab() {
    // Navigate this tab to the page (Back returns to the homepage).
    location.href = this.url;
  },
};

async function openPeek(url, label, fromRect) {
  // Permission (first time only) has to be asked while we still have the click's gesture.
  const granted = await chrome.permissions.request({ origins: PEEK_ORIGINS }).catch(() => false);
  if (!granted || !(await allowFramingInThisTab())) { location.href = url; return; } // fall back to a normal visit
  peek.open(url, label, fromRect);
  peekDiagnostics(url); // TEMP: remove once framing works
}

// TEMP diagnostics for sites that still refuse to load in peek.
async function peekDiagnostics(url) {
  const dnr = chrome.declarativeNetRequest;
  const tab = await new Promise(r => chrome.tabs.getCurrent(r));
  console.log("[peek] url", url, "tab", tab?.id, "extension", chrome.runtime.id);
  console.log("[peek] session rules", JSON.stringify(await dnr.getSessionRules()));
  setTimeout(async () => {
    try {
      const m = await dnr.getMatchedRules({ tabId: tab.id });
      console.log("[peek] matched in this tab", JSON.stringify(m.rulesMatchedInfo));
      const all = await dnr.getMatchedRules({});
      console.log("[peek] matched anywhere", JSON.stringify(all.rulesMatchedInfo));
    } catch (e) { console.log("[peek] getMatchedRules failed", e.message); }
  }, 3000);
}

document.addEventListener("click", e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.("a[href]");
  if (!a || !/^https?:/.test(a.href) || a.closest("#cmd-backdrop, dialog, .peek-backdrop")) return;
  if (!peekOn(peekKind(a))) return;
  e.preventDefault(); // the link's own click handlers (seen marks etc.) still run
  const label = a.querySelector(".label")?.textContent?.trim() || a.textContent.trim().split("\n")[0];
  openPeek(a.href, label, a.getBoundingClientRect());
}, true);

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
if (REOPENING) { /* focus.js is replacing this tab */ }
else if (!bm) showError("The extension doesn't have bookmarks permission yet. Open chrome://extensions and click the reload icon on Home.");
else {
  paintSnapshot();
  load().catch(e => showError(String(e?.message || e)));
  setTimeout(markReady, 600); // never stay hidden if something stalls
}

// Bookmark actions, drag and drop of links, and rendering of folder and widget cards.
// (Plain script sharing globals with the other newtab files; see index.html for load order.)

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

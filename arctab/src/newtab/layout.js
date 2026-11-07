// Page layout: saved columns/cards state, adding and removing cards, the Add to page dialog, drag targets, and the hand-placed column layout.
// (Plain script sharing globals with the other newtab files; see index.html for load order.)

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

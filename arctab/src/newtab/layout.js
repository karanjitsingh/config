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
//   order:     every card id, in the order arrange() places them across columns (cols
//              still decides the order within a column; this decides how the columns
//              interleave, so a card can sit below a wide card from another column).
//              Ids missing from it are placed row by row, as before it existed.
//              Only used now to place cards that have no `pos` yet.
//   pos:       { cardId: top px } where you put each card. Cards stay there; one that
//              something has grown into is pushed down just enough (not saved), and goes
//              back once there's room. Cards without one go below their column and get one.
//   version:   2 = cols lists exactly the cards on the page. Before that every top-level
//              folder showed automatically (plus v1's `widgets`/`hidden` lists).
// Cards are bookmark folder ids or "widget:<id>". Nothing appears on its own: folders and
// widgets are added from "+ Add to page" and removed with ✕ (the folder stays in bookmarks).
const LAYOUT_KEY = "layout";
const LAYOUT_VERSION = 2;
const MAX_COLS = 5;
const layout = { columns: 3, cols: [[], [], []], collapsed: new Set(), open: new Set(), sizes: {}, order: [], pos: {}, version: 0, legacy: null, loaded: false };
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
    layout.order = saved.order || [];
    layout.pos = saved.pos || {};
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
    order: layout.order.filter(onPage),
    pos: Object.fromEntries(Object.entries(layout.pos).filter(([id]) => onPage(id))),
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

// Dropped in column colIndex with its top at y (px from the top of the sections).
function moveSection(id, colIndex, y) {
  document.body.classList.remove("dragging-section"); // the dragged node is re-rendered, so dragend may not fire
  layout.cols.forEach(c => { const i = c.indexOf(id); if (i !== -1) c.splice(i, 1); });
  layout.cols[colIndex].push(id); // order within a column doesn't matter any more: pos does
  layout.pos[id] = Math.max(0, Math.round(y));
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
  layout.order.push(id);
  delete layout.pos[id]; // goes below what's in its column, then keeps that spot
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
  let hover = false;
  const sync = () => {
    const on = onPage(id);
    b.textContent = on ? (hover ? "Remove" : "Added") : "Add";
    b.classList.toggle("on", on);
    b.title = on ? "Remove from page" : "Add to page";
  };
  // Added says what a click would do while you're on it.
  b.addEventListener("mouseenter", () => { hover = true; sync(); });
  b.addEventListener("mouseleave", () => { hover = false; sync(); });
  b.addEventListener("click", () => { onPage(id) ? removeCard(id, title) : add(); sync(); });
  sync();
  return b;
}

function galleryItem({ icon, title, desc, action }) {
  return el("div", { className: "wg-item" },
    svgNode(icon, "wg-ico"),
    el("div", { className: "wg-text" },
      el("div", { className: "wg-title", textContent: title }),
      desc ? el("div", { className: "wg-desc", textContent: desc, title: desc }) : ""), // clamped to two lines; hover for all of it
    action);
}
// A labelled group of rows, like a settings list.
const gallerySection = (label, rows) => (rows.length
  ? [el("div", { className: "wg-sec", textContent: label }), el("div", { className: "wg-group" }, ...rows)]
  : []);

function openAddDialog() {
  const folder = galleryItem({ icon: ICONS.folder, title: "Bookmarks folder",
    desc: "Links from one of your bookmark folders.", action: svgNode(ICONS.chevron, "wg-go") });
  folder.classList.add("clickable");
  folder.tabIndex = 0;
  folder.addEventListener("click", showFolderPicker);
  folder.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showFolderPicker(); } });
  const widgets = [...WIDGETS.values()].map(d => galleryItem({ icon: d.icon || ICONS.widget, title: d.title,
    desc: d.description, action: toggleButton(widgetKey(d.id), () => addWidget(d), d.title) }));
  $("#wg-list").replaceChildren(...gallerySection("Bookmarks", [folder]), ...gallerySection("Widgets", widgets));
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

// While a card is dragged, the page previews the drop: the other cards move as they
// would, and a dashed outline shows where the card itself lands.
let draggingCard = null;
let dragGrabY = 0; // where in the card the pointer took hold (set on dragstart)
let dragSlot = null; // the drop being previewed, so a re-layout mid-drag keeps the preview
let dragEdges = null; // where a drop can line up: 0 and every other card's top and bottom (as of the drag's start)
const dropGhost = el("div", { className: "drop-ghost" });

function columnNode(index) {
  return el("div", { className: "col", dataset: { col: index } });
}

// Where a drop would go: the column under the pointer (its x, not the element under it:
// a wide card belongs to its first column but covers others), and the card's top where
// the pointer would put it.
function dropSlot(e) {
  const { sec, n, gap, colW } = columnMetrics();
  const r = sec.getBoundingClientRect();
  let ci;
  if (n === 1) ci = Math.max(0, [...sec.querySelectorAll(":scope > .col")].indexOf(e.target.closest?.(".col"))); // stacked
  else ci = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left + gap / 2) / (colW + gap))));
  // Snap to the nearest card edge, so the preview changes in clear steps instead of
  // nudging the other cards on every pixel the pointer moves.
  dragEdges ||= [0, ...[...sec.querySelectorAll(".col > .card:not(.dragging)")].flatMap(c => {
    const top = parseFloat(c.style.top) || 0;
    return [top, top + c.offsetHeight + gap];
  })];
  const raw = Math.max(0, e.clientY - r.top - dragGrabY);
  const y = dragEdges.reduce((best, v) => (Math.abs(v - raw) < Math.abs(best - raw) ? v : best), 0);
  return { ci, y };
}

// Preview a drop (or with no slot, put everything back).
function previewDrop(slot) {
  if (slot && dragSlot && slot.ci === dragSlot.ci && slot.y === dragSlot.y && dropGhost.isConnected) return dragSlot.spot; // nothing changed
  dragSlot = slot;
  const spot = slot && arrange({ id: draggingCard?.dataset.id, lane: slot.ci, y: slot.y });
  if (!spot) { dropGhost.remove(); return null; }
  Object.assign(dropGhost.style, { left: `${spot.left}px`, top: `${spot.top}px`, width: `${spot.width}px`, height: `${spot.height}px` });
  if (!dropGhost.isConnected) $("#sections").append(dropGhost);
  slot.spot = spot;
  return spot;
}

const sectionsEl = $("#sections");
sectionsEl.addEventListener("dragover", e => {
  if (!isSectionDrag(e)) return;
  e.preventDefault();
  previewDrop(dropSlot(e));
});
sectionsEl.addEventListener("dragleave", e => {
  if (sectionsEl.contains(e.relatedTarget)) return;
  clearDropMarks();
  previewDrop(null);
  arrange();
});
sectionsEl.addEventListener("drop", e => {
  if (!isSectionDrag(e)) return;
  e.preventDefault();
  const slot = dropSlot(e);
  const spot = previewDrop(slot);
  clearDropMarks();
  dragSlot = dragEdges = null; // the dragged card is re-rendered, so its dragend may not fire
  moveSection(e.dataTransfer.getData(SECTION_TYPE), slot.ci, spot ? spot.top : slot.y);
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

// Every card on the page in placement order: each column's cards in their own order,
// interleaved by layout.order (cards it doesn't list go row by row, after those it does).
function placementOrder() {
  const rank = new Map(layout.order.map((id, i) => [id, i]));
  const key = (id, row, c) => rank.get(id) ?? 1e6 + row * 10 + c;
  const heads = layout.cols.map(() => 0);
  const out = [];
  for (;;) {
    let best = -1, bestKey = Infinity;
    layout.cols.forEach((col, c) => {
      const id = col[heads[c]];
      if (id !== undefined && key(id, heads[c], c) < bestKey) { best = c; bestKey = key(id, heads[c], c); }
    });
    if (best === -1) return out;
    out.push(layout.cols[best][heads[best]++]);
  }
}

// Positions every card. Each sits at its saved top (layout.pos), unless a card above it in
// the columns it covers has grown into it: then it goes just below that one (for now; its
// saved top stays, so it moves back up when there's room). Cards with no saved top go below
// everything in their column, in row-by-row order, and keep that spot.
// drag: { id, lane, y } previews a drop: that card is placed there (its element isn't
// moved; it's hidden while dragging) and the rest make room. Returns where it landed.
function arrange(drag) {
  const { sec, n, W, gap, colW } = columnMetrics();
  const cols = [...sec.querySelectorAll(":scope > .col")];
  if (!cols.length || !W) return null;
  const single = n === 1;
  cols.forEach((c, i) => {
    c.style.left = `${single ? 0 : i * (colW + gap)}px`;
    c.style.width = `${single ? W : colW}px`;
  });
  const spanOf = (id, lane) => (single ? 1 : Math.max(1, Math.min(layout.sizes[id]?.span || 1, n - lane)));
  const widthOf = span => span * colW + (span - 1) * gap;

  // Narrow window: one stack, column after column.
  if (single) {
    let top = 0;
    for (const c of cols) for (const card of c.querySelectorAll(":scope > .card")) {
      card.style.width = `${W}px`;
      card.style.top = `${top}px`;
      top += card.offsetHeight + gap;
    }
    sec.style.height = `${Math.max(0, top - gap)}px`;
    return null;
  }

  const items = [];
  cols.forEach((c, lane) => c.querySelectorAll(":scope > .card").forEach(card => {
    const id = card.dataset.id;
    if (drag && id === drag.id) return; // placed at the drop spot instead
    const span = spanOf(id, lane);
    card.style.width = `${widthOf(span)}px`;
    items.push({ card, id, lane, span, y: layout.pos[id] });
  }));
  for (const it of items) it.h = it.card.offsetHeight; // after the widths: text wraps differently
  let dragged = null;
  if (drag) {
    dragged = { id: drag.id, lane: drag.lane, span: spanOf(drag.id, drag.lane), y: drag.y, h: Math.max(48, draggingCard?.offsetHeight || 80) };
    items.push(dragged);
  }

  const covers = (a, b) => a.lane < b.lane + b.span && b.lane < a.lane + a.span;
  const placed = [];
  // Lowest top at or below y where it doesn't overlap anything placed so far.
  const fit = it => {
    let top = Math.max(0, it.y);
    for (let moved = true; moved;) {
      moved = false;
      for (const p of placed) {
        if (covers(it, p) && top < p.top + p.h + gap && top + it.h + gap > p.top) { top = p.top + p.h + gap; moved = true; }
      }
    }
    return top;
  };
  // Saved spots first, top to bottom (a dropped card wins a tie), then the new ones.
  const known = items.filter(it => it.y !== undefined)
    .sort((a, b) => (a.y - b.y) || ((b === dragged) - (a === dragged)) || (a.lane - b.lane));
  const rank = new Map(placementOrder().map((id, i) => [id, i]));
  const fresh = items.filter(it => it.y === undefined).sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  for (const it of known) { it.top = fit(it); placed.push(it); }
  let seeded = false;
  for (const it of fresh) {
    it.y = Math.max(0, ...placed.filter(p => covers(it, p)).map(p => p.top + p.h + gap));
    it.top = fit(it);
    placed.push(it);
    if (!drag) { layout.pos[it.id] = it.top; seeded = true; }
  }
  for (const it of placed) if (it.card) it.card.style.top = `${it.top}px`;
  sec.style.height = `${Math.max(0, ...placed.map(p => p.top + p.h))}px`;
  if (seeded) saveLayout();
  return dragged && { left: dragged.lane * (colW + gap), top: dragged.top, width: widthOf(dragged.span), height: dragged.h };
}

// Re-run when anything changes size: content loading, collapsing, the window.
let arrangeQueued = false;
const queueArrange = () => {
  if (arrangeQueued) return;
  arrangeQueued = true;
  requestAnimationFrame(() => {
    arrangeQueued = false;
    if (draggingCard && dragSlot) { const slot = dragSlot; dragSlot = null; previewDrop(slot); } // re-run, keeping the preview
    else arrange();
  });
};
const cardObserver = new ResizeObserver(queueArrange);
function observeCards() {
  cardObserver.disconnect();
  cardObserver.observe($("#sections"));
  document.querySelectorAll("#sections .card").forEach(c => cardObserver.observe(c));
}

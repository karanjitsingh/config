// Widgets: live cards that sit in the section columns next to bookmark sections. They
// drag, collapse and save their spot like any section.
//
// A widget registers itself (see widgets.local.js for a real one):
//   registerWidget({
//     id: "weather",                 // stable; the layout stores "widget:<id>"
//     title: "Weather",
//     description: "…",              // shown in "+ Add to page"
//     icon: "<svg …>",                // optional, static markup for the gallery tile
//     link: "https://…",             // optional: ↗ in the header opens it
//     origins: ["https://api…/*"],   // hosts fetch() needs (asked for when added)
//     refreshMs: 60_000,             // how stale the cached data may get
//     resizable: true,               // optional: corner grip to span columns / set height
//     async fetch() { return data }, // JSON-serialisable; throw widgetAuthError(url) when signed out
//     render(data) { return [nodes] },
//     count(data) { return n },      // optional: number shown next to the title
//     updates(data) { return [{ kind, title, sub, url }] }, // kind: a short type label, e.g. "review" // optional: what's new, shown under
//                                    // the quick search bar (Ctrl+T) until you've seen it
//   });
//
// Data is cached in localStorage so a new tab paints the last result instantly, then
// refreshes in the background once it's older than refreshMs.

const WIDGETS = new Map();
// Widgets from local/ stay unregistered while local extras are off (their layout spot is
// kept, so they come back where they were).
const registerWidget = def => {
  if (LOCAL_WIDGETS_OFF && /\/local\//.test(document.currentScript?.src || "")) return;
  WIDGETS.set(def.id, def);
};
// Same rule as LOCAL_EXTRAS_OFF in config.merge.js (not loaded everywhere this is).
const LOCAL_WIDGETS_OFF = (() => { try { const v = localStorage.localExtras; return v ? v !== "on" : !(typeof LOCAL_EXTRAS !== "undefined" && LOCAL_EXTRAS.defaultOn); } catch { return true; } })();
const widgetKey = id => `widget:${id}`;
const isWidgetKey = key => typeof key === "string" && key.startsWith("widget:");

function widgetAuthError(signInUrl) {
  return Object.assign(new Error("Signed out"), { auth: true, signInUrl });
}

// ---------- cache ----------
const widgetCache = {
  get(id) { try { return JSON.parse(localStorage.getItem(widgetKey(id)) || "null"); } catch { return null; } },
  set(id, v) { try { localStorage.setItem(widgetKey(id), JSON.stringify(v)); } catch { /* full */ } },
  drop(id) { localStorage.removeItem(widgetKey(id)); },
};

// ---------- relative time ("24m ago") ----------
function ago(sec) {
  if (!sec) return "";
  const s = Math.max(0, Date.now() / 1000 - sec);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(sec * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---------- runtime ----------
// One body element per widget, kept across re-renders of the page (load() rebuilds every
// card on any bookmark change), so a widget never flashes back to empty.
const widgetUi = new Map(); // id -> { body, count, status: "idle"|"loading", error }

function widgetBody(def) {
  let ui = widgetUi.get(def.id);
  if (!ui) {
    ui = { body: el("div", { className: "body widget-body" }), count: el("span", { className: "count" }), status: "idle", error: null };
    widgetUi.set(def.id, ui);
    ui.body.addEventListener("scroll", () => updateFade(ui.body), { passive: true });
    fadeObserver.observe(ui.body);
    paintWidget(def);
  }
  return ui;
}

function paintWidget(def) {
  const ui = widgetUi.get(def.id);
  if (!ui) return;
  const cached = widgetCache.get(def.id);
  const nodes = [];
  if (ui.error) nodes.push(widgetError(def, ui.error));
  if (cached) {
    nodes.push(...def.render(cached.data));
    const n = def.count?.(cached.data);
    ui.count.textContent = n ?? "";
    publishUpdates(def, cached);
  } else if (!ui.error) {
    nodes.push(el("div", { className: "empty", textContent: "Loading…" }));
  }
  ui.body.classList.toggle("loading", ui.status === "loading");
  ui.body.replaceChildren(...nodes);
  updateFade(ui.body);
}

// ---------- updates for the quick search bar ----------
// Widgets that know what's new publish it to chrome.storage (the Ctrl+T overlay can't
// rely on this page's localStorage). Repainting republishes, so seen items drop off.
// Opening an item from the overlay is recorded in UPDATES_OPENED for widgets to mark seen.
const UPDATES_KEY = "arctabUpdates";
const UPDATES_OPENED = "arctabOpened";
const publishedUpdates = new Map(); // id -> JSON last written, to skip no-op writes
async function publishUpdates(def, { data, at }) {
  if (!def.updates) return;
  let items;
  try { items = def.updates(data) || []; } catch { return; }
  const json = JSON.stringify([items, at]);
  if (publishedUpdates.get(def.id) === json) return;
  publishedUpdates.set(def.id, json);
  await navigator.locks.request(UPDATES_KEY, async () => {
    const { [UPDATES_KEY]: all = {} } = await chrome.storage.local.get(UPDATES_KEY);
    if (items.length) all[def.id] = { title: def.title, items, at }; // at: when the data was fetched
    else delete all[def.id];
    await chrome.storage.local.set({ [UPDATES_KEY]: all });
  });
}
// The widget's half of UPDATES_OPENED: { url: ms } for items opened from the overlay.
async function openedFromOverlay() {
  const { [UPDATES_OPENED]: opened = {} } = await chrome.storage.local.get(UPDATES_OPENED);
  return opened;
}

// When a sized widget has more than fits, fade the edge(s) that have more content past them.
function updateFade(body) {
  const more = body.scrollHeight - body.clientHeight > 1;
  body.classList.toggle("fade-top", more && body.scrollTop > 1);
  body.classList.toggle("fade-bottom", more && body.scrollTop + body.clientHeight < body.scrollHeight - 1);
}
const fadeObserver = new ResizeObserver(entries => entries.forEach(e => updateFade(e.target)));

function widgetError(def, err) {
  const box = el("div", { className: "widget-msg" });
  if (err.permission) {
    const b = el("button", { type: "button", textContent: "Allow access" });
    b.addEventListener("click", () => chrome.permissions.request({ origins: def.origins }, ok => ok && refreshWidget(def, true)));
    box.append(el("span", { textContent: "Needs permission to reach its server. " }), b);
  } else if (err.auth) {
    box.append(el("span", { textContent: "Signed out. " }),
      el("a", { href: err.signInUrl || def.link || "#", target: "_blank", textContent: "Sign in" }),
      el("span", { textContent: ", then come back." }));
  } else {
    const b = el("button", { type: "button", textContent: "Retry" });
    b.addEventListener("click", () => refreshWidget(def, true));
    box.append(el("span", { textContent: `Couldn't load: ${err.message || err} ` }), b);
  }
  return box;
}

async function refreshWidget(def, force = false) {
  const ui = widgetUi.get(def.id);
  if (!ui || ui.status === "loading") return;
  const cached = widgetCache.get(def.id);
  if (!force && cached && Date.now() - cached.at < (def.refreshMs ?? 60_000)) return;
  ui.status = "loading";
  paintWidget(def);
  try {
    if (def.origins?.length && !(await chrome.permissions.contains({ origins: def.origins }))) {
      throw Object.assign(new Error("No permission"), { permission: true });
    }
    const data = await def.fetch();
    widgetCache.set(def.id, { at: Date.now(), data });
    ui.error = null;
  } catch (e) {
    ui.error = { message: e.message, auth: !!e.auth, permission: !!e.permission, signInUrl: e.signInUrl };
  }
  ui.status = "idle";
  paintWidget(def);
  saveSnapshot();
}

// Keep relative times fresh and data current while the page is open.
function tickWidgets(force = false) {
  if (document.visibilityState !== "visible") return;
  for (const id of widgetUi.keys()) {
    const def = WIDGETS.get(id);
    if (!def) continue;
    paintWidget(def);
    refreshWidget(def, force);
  }
}
setInterval(tickWidgets, 60_000);
document.addEventListener("visibilitychange", () => tickWidgets());

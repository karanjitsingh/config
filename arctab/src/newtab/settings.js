// Settings dialog (gear in the footer).
//
// Search shortcuts: these belong to this homepage's command bar, not to Chrome's site
// search. config.js + config.local.js are the defaults. Once you save from Settings,
// the list in chrome.storage.local wins (so deleting a default sticks) until you reset.
// SEARCH is updated in place, so omnibox.js always reads the current set.

const SHORTCUTS_KEY = "searchShortcuts";
const SEARCH_DEFAULTS = structuredClone(SEARCH);

let shortcutsAside = {}; // local shortcuts hidden while local extras are off; saved back untouched
function applyShortcuts(map) {
  const [shown, aside] = splitLocalShortcuts(map);
  shortcutsAside = aside;
  for (const k of Object.keys(SEARCH)) delete SEARCH[k];
  Object.assign(SEARCH, shown || SEARCH_DEFAULTS);
}

chrome.storage.local.get(SHORTCUTS_KEY).then(({ [SHORTCUTS_KEY]: saved }) => applyShortcuts(saved));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && SHORTCUTS_KEY in changes) applyShortcuts(changes[SHORTCUTS_KEY].newValue);
});

// ---------- dialog ----------
// Every change saves immediately; there is no Save button.
const settingsDlg = $("#settings");
const scList = $("#sc-list");
let editing = null; // key being edited, "" for a new shortcut

async function saveShortcuts(map) {
  const isDefault = JSON.stringify(map) === JSON.stringify(SEARCH_DEFAULTS) && !Object.keys(shortcutsAside).length;
  const stored = { ...map, ...shortcutsAside };
  if (isDefault) await chrome.storage.local.remove(SHORTCUTS_KEY);
  else await chrome.storage.local.set({ [SHORTCUTS_KEY]: stored });
  applyShortcuts(isDefault ? null : stored);
}

function engineIcon(url) {
  let page = url.replace("%s", "");
  try { page = new URL(page).origin; } catch { /* chrome:// etc. */ }
  const img = el("img", { className: "sc-ico", src: favicon(page, 32), alt: "", width: 16, height: 16 });
  img.onerror = () => img.replaceWith(el("span", { className: "sc-ico" }));
  return img;
}

const prettyUrl = url => url.replace(/^https?:\/\//, "").replace(/^www\./, "");

function viewRow(key, { name, url }) {
  const edit = el("button", { type: "button", className: "act", title: "Edit", textContent: "✎" });
  const del = el("button", { type: "button", className: "act", title: "Delete", textContent: "✕" });
  const row = el("div", { className: "sc-row", tabIndex: 0, title: "Click to edit" },
    engineIcon(url),
    el("span", { className: "sc-key", textContent: key }),
    el("span", { className: "sc-name", textContent: name }),
    el("span", { className: "sc-url", textContent: prettyUrl(url) }),
    el("span", { className: "sc-acts" }, edit, del));
  const open = () => { editing = key; renderShortcuts(); };
  row.addEventListener("click", e => { if (!e.target.closest(".act")) open(); });
  row.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); open(); } });
  edit.addEventListener("click", open);
  del.addEventListener("click", async () => {
    const map = { ...SEARCH };
    delete map[key];
    await saveShortcuts(map);
    renderShortcuts();
  });
  return row;
}

function editRow(key, { name = "", url = "" } = {}) {
  const input = (cls, value, placeholder) => el("input", { className: cls, value, placeholder, autocomplete: "off", spellcheck: false });
  const fKey = input("sc-in-key", key, "key");
  const fName = input("sc-in-name", name, "Name");
  const fUrl = input("sc-in-url", url, "https://example.com/search?q=%s");
  const err = el("div", { className: "sc-err" });
  const save = el("button", { type: "button", className: "primary", textContent: key ? "Save" : "Add" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  const row = el("div", { className: "sc-edit" },
    el("div", { className: "sc-edit-top" }, fKey, fName),
    fUrl, err,
    el("div", { className: "sc-edit-btns" }, cancel, save));

  const close = () => { editing = null; renderShortcuts(); };
  const commit = async () => {
    const k = fKey.value.trim().toLowerCase();
    const u = fUrl.value.trim();
    const problem = !k ? "Give it a key, like “gh”"
      : /\s/.test(k) ? "The key can't contain spaces"
      : k !== key && SEARCH[k] ? `“${k}” is already used by ${SEARCH[k].name}`
      : !/^(https?|chrome):\/\//.test(u) ? "The URL must start with https:// (or chrome://)"
      : !u.includes("%s") ? "Put %s in the URL where the search text goes"
      : null;
    if (problem) { err.textContent = problem; return; }
    // Keep the list order: replace in place when editing.
    // Spread first so extra fields (like `direct`) survive an edit.
    const entries = Object.entries(SEARCH).map(([kk, v]) => kk === key ? [k, { ...v, name: fName.value.trim() || k, url: u }] : [kk, v]);
    if (!key) entries.push([k, { name: fName.value.trim() || k, url: u }]);
    await saveShortcuts(Object.fromEntries(entries));
    close();
  };
  save.addEventListener("click", commit);
  cancel.addEventListener("click", close);
  row.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } // cancel the edit, keep the dialog
  });
  queueMicrotask(() => (key ? fName : fKey).focus());
  return row;
}

function renderShortcuts() {
  const rows = Object.entries(SEARCH).map(([k, v]) => (k === editing ? editRow(k, v) : viewRow(k, v)));
  if (editing === "") rows.unshift(editRow(""));
  if (!rows.length) rows.push(el("p", { className: "hint", textContent: "No shortcuts. Add one, or reset to defaults." }));
  scList.replaceChildren(...rows);
}

// Sidebar sections; remembers the last one you looked at.
function showPane(name) {
  for (const t of settingsDlg.querySelectorAll(".set-tab")) t.classList.toggle("on", t.dataset.pane === name);
  for (const p of settingsDlg.querySelectorAll(".set-pane")) p.hidden = p.dataset.pane !== name;
  localStorage.settingsPane = name;
}
for (const t of settingsDlg.querySelectorAll(".set-tab")) t.addEventListener("click", () => showPane(t.dataset.pane));

$("#open-settings").addEventListener("click", () => {
  showPane(settingsDlg.querySelector(`.set-tab[data-pane="${localStorage.settingsPane}"]:not([hidden])`) ? localStorage.settingsPane : "general");
  editing = null;
  renderShortcuts();
  $("#set-focus").checked = localStorage.focusPage !== "off";
  $("#set-showhome").checked = localStorage.newTabMode !== "search";
  $("#set-ovfavs").checked = localStorage.overlayFavs !== "off";
  $("#set-favdigits").checked = localStorage.favDigits !== "off";
  $("#set-local").checked = !LOCAL_EXTRAS_OFF;
  $("#set-ovupdates").checked = localStorage.overlayUpdates !== "off";
  chrome.storage.local.get("ctrlTOverlay").then(({ ctrlTOverlay }) => { $("#set-overlay").checked = ctrlTOverlay !== false; });
  fillPeekKinds();
  settingsDlg.showModal();
  document.activeElement?.blur(); // no focus ring on the first item when opened with the mouse
});

$("#set-showhome").addEventListener("change", e => {
  localStorage.newTabMode = e.target.checked ? "home" : "search";
});
$("#set-ovfavs").addEventListener("change", e => {
  localStorage.overlayFavs = e.target.checked ? "on" : "off";
});
// Local extras (everything from local/): only offered when local/ defines LOCAL_EXTRAS,
// e.g. { label: "Work", description: "…", defaultOn: true }. Off by default. Turning it off or on reloads the page,
// since widgets and shortcuts are picked up at startup.
if (typeof LOCAL_EXTRAS !== "undefined") {
  $("#local-cat").hidden = false;
  $("#local-pane-name").textContent = LOCAL_EXTRAS.label;
  $("#local-row-name").textContent = `${LOCAL_EXTRAS.label} features`;
  if (LOCAL_EXTRAS.description) $("#local-lede").textContent = LOCAL_EXTRAS.description;
  // Extra switches local/ asks for: LOCAL_EXTRAS.settings = [{ key, label, hint, default }],
  // each stored as localStorage[key] = "on" | "off". Greyed out while the main switch is off.
  const group = $("#set-local").closest(".set-group");
  for (const opt of LOCAL_EXTRAS.settings || []) {
    const box = el("input", { type: "checkbox", className: "switch" });
    const sync = () => {
      box.checked = localStorage[opt.key] ? localStorage[opt.key] === "on" : opt.default !== false;
      box.disabled = LOCAL_EXTRAS_OFF;
    };
    sync();
    $("#open-settings").addEventListener("click", sync);
    box.addEventListener("change", () => { localStorage[opt.key] = box.checked ? "on" : "off"; });
    group.append(el("label", { className: "set-row" },
      el("span", { className: "set-text" }, el("b", { textContent: opt.label }), ...(opt.hint ? [el("span", { className: "hint", textContent: opt.hint })] : [])),
      box));
  }
  $("#set-local").addEventListener("change", async e => {
    const on = e.target.checked;
    localStorage.localExtras = on ? "on" : "off";
    await chrome.storage.local.set({ localExtras: on }); // for background.js
    if (!on) await chrome.storage.local.remove("arctabUpdates"); // drop their quick-search updates now
    location.reload();
  });
}
$("#set-favdigits").addEventListener("change", e => {
  localStorage.favDigits = e.target.checked ? "on" : "off";
});
$("#set-ovupdates").addEventListener("change", e => {
  localStorage.overlayUpdates = e.target.checked ? "on" : "off";
});
// Read by background.js, which can't see this page's localStorage.
$("#set-overlay").addEventListener("change", e => {
  chrome.storage.local.set({ ctrlTOverlay: e.target.checked });
});
$("#set-focus").addEventListener("change", e => {
  localStorage.focusPage = e.target.checked ? "on" : "off";
});
// One toggle per kind of link: favorites, bookmark cards, and each installed widget.
function fillPeekKinds() {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.peekKinds || "{}"); } catch { /* start fresh */ }
  if (localStorage.peek === "off") { // migrate the old single switch
    cfg = Object.fromEntries(["fav", "link", ...[...WIDGETS.keys()].map(widgetKey)].map(k => [k, false]));
    localStorage.peekKinds = JSON.stringify(cfg);
    localStorage.removeItem("peek");
  }
  const kinds = [["fav", "Favorites"], ["link", "Links in bookmark folders"], ...[...WIDGETS.values()].map(d => [widgetKey(d.id), d.title])];
  $("#peek-kinds").replaceChildren(...kinds.map(([key, name]) => {
    const box = el("input", { type: "checkbox", checked: cfg[key] !== false });
    box.addEventListener("change", () => {
      cfg[key] = box.checked;
      localStorage.peekKinds = JSON.stringify(cfg);
    });
    box.className = "switch";
    return el("label", { className: "set-row" }, el("span", { className: "set-text" }, el("b", { textContent: name })), box);
  }));
}

$("#sc-add").addEventListener("click", () => { editing = ""; renderShortcuts(); scList.scrollTop = 0; });

$("#sc-reset").addEventListener("click", async () => {
  if (!confirm("Replace your shortcuts with the defaults?")) return;
  await saveShortcuts(structuredClone(SEARCH_DEFAULTS));
  editing = null;
  renderShortcuts();
});

// ⌘, (Ctrl+, elsewhere) opens these settings; pressing it again while they're open goes
// on to Chrome's own settings in this tab, which is what ⌘, normally does.
document.addEventListener("keydown", e => {
  if (e.key !== "," || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  e.preventDefault();
  e.stopPropagation();
  if (settingsDlg.open) {
    settingsDlg.close();
    // Pages can't link to chrome:// directly, so navigate this tab through the tabs API.
    chrome.tabs.getCurrent(tab => (tab ? chrome.tabs.update(tab.id, { url: "chrome://settings" }) : chrome.tabs.create({ url: "chrome://settings" })));
  } else {
    document.querySelector("dialog[open]")?.close();
    $("#open-settings").click();
  }
}, true);

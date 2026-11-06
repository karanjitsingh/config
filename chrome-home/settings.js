// Settings dialog (gear in the footer).
//
// Search shortcuts: these belong to this homepage's command bar, not to Chrome's site
// search. config.js + config.local.js are the defaults. Once you save from Settings,
// the list in chrome.storage.local wins (so deleting a default sticks) until you reset.
// SEARCH is updated in place, so omnibox.js always reads the current set.

const SHORTCUTS_KEY = "searchShortcuts";
const SEARCH_DEFAULTS = structuredClone(SEARCH);

function applyShortcuts(map) {
  for (const k of Object.keys(SEARCH)) delete SEARCH[k];
  Object.assign(SEARCH, map || SEARCH_DEFAULTS);
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
  const isDefault = JSON.stringify(map) === JSON.stringify(SEARCH_DEFAULTS);
  if (isDefault) await chrome.storage.local.remove(SHORTCUTS_KEY);
  else await chrome.storage.local.set({ [SHORTCUTS_KEY]: map });
  applyShortcuts(isDefault ? null : map);
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
    const entries = Object.entries(SEARCH).map(([kk, v]) => kk === key ? [k, { name: fName.value.trim() || k, url: u }] : [kk, v]);
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

$("#open-settings").addEventListener("click", () => {
  editing = null;
  renderShortcuts();
  $("#set-focus").checked = localStorage.focusPage !== "off";
  settingsDlg.showModal();
});

$("#set-focus").addEventListener("change", e => {
  localStorage.focusPage = e.target.checked ? "on" : "off";
});

$("#sc-add").addEventListener("click", () => { editing = ""; renderShortcuts(); scList.scrollTop = 0; });

$("#sc-reset").addEventListener("click", async () => {
  if (!confirm("Replace your shortcuts with the defaults?")) return;
  await saveShortcuts(structuredClone(SEARCH_DEFAULTS));
  editing = null;
  renderShortcuts();
});

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
const settingsDlg = $("#settings");
const scList = $("#sc-list");

function shortcutRow(key = "", name = "", url = "") {
  const input = (field, value, placeholder) =>
    el("input", { className: `sc-${field}`, value, placeholder, autocomplete: "off", spellcheck: false });
  const del = el("button", { type: "button", className: "act", title: "Delete", textContent: "✕" });
  const row = el("div", { className: "sc-row" },
    input("key", key, "key"), input("name", name, "Name"), input("url", url, "https://example.com/search?q=%s"), del);
  del.addEventListener("click", () => row.remove());
  return row;
}

function fillShortcuts(map) {
  scList.replaceChildren(...Object.entries(map).map(([k, v]) => shortcutRow(k, v.name, v.url)));
}

// Returns the shortcuts map, or an error string.
function readShortcuts() {
  const out = {};
  for (const row of scList.children) {
    const key = row.querySelector(".sc-key").value.trim().toLowerCase();
    const name = row.querySelector(".sc-name").value.trim();
    const url = row.querySelector(".sc-url").value.trim();
    row.classList.remove("bad");
    if (!key && !url) continue; // blank row: ignore
    const err = !key ? "needs a key"
      : /\s/.test(key) ? "key can't contain spaces"
      : out[key] ? `key “${key}” is used twice`
      : !/^(https?|chrome):\/\//.test(url) ? "URL must start with https:// (or chrome://)"
      : !url.includes("%s") ? "URL needs %s where the search text goes"
      : null;
    if (err) { row.classList.add("bad"); return `${key || "A shortcut"}: ${err}`; }
    out[key] = { name: name || key, url };
  }
  return out;
}

$("#open-settings").addEventListener("click", () => {
  fillShortcuts(SEARCH);
  $("#set-focus").checked = localStorage.focusPage !== "off";
  $("#set-error").textContent = "";
  settingsDlg.showModal();
});

$("#sc-add").addEventListener("click", () => {
  const row = shortcutRow();
  scList.append(row);
  row.querySelector(".sc-key").focus();
});

$("#sc-reset").addEventListener("click", () => fillShortcuts(SEARCH_DEFAULTS));

settingsDlg.querySelector("form").addEventListener("submit", async e => {
  if (e.submitter?.value !== "ok") return; // Cancel just closes
  const map = readShortcuts();
  if (typeof map === "string") {
    e.preventDefault(); // keep the dialog open
    $("#set-error").textContent = map;
    return;
  }
  const isDefault = JSON.stringify(map) === JSON.stringify(SEARCH_DEFAULTS);
  if (isDefault) await chrome.storage.local.remove(SHORTCUTS_KEY);
  else await chrome.storage.local.set({ [SHORTCUTS_KEY]: map });
  applyShortcuts(isDefault ? null : map);
  localStorage.focusPage = $("#set-focus").checked ? "on" : "off";
  toast("Settings saved");
});

// Search shortcuts saved in Settings (see src/newtab/settings.js) apply here too.
chrome.storage.local.get("searchShortcuts").then(({ searchShortcuts }) => {
  if (!searchShortcuts) return;
  for (const k of Object.keys(SEARCH)) delete SEARCH[k];
  Object.assign(SEARCH, splitLocalShortcuts(searchShortcuts)[0]);
});

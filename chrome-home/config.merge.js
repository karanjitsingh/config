// Runs after config.js and the optional config.local.js.
const SEARCH = { ...SEARCH_BASE, ...(typeof SEARCH_LOCAL !== "undefined" ? SEARCH_LOCAL : {}) };

// The URL a shortcut opens for a query (see `direct` in config.js).
function shortcutUrl(engine, query) {
  const q = query.trim();
  if (engine.direct) {
    try { if (new RegExp(engine.direct.match, "i").test(q)) return engine.direct.url.replace("%s", encodeURIComponent(q)); }
    catch { /* bad regex: fall through to search */ }
  }
  return engine.url.replace("%s", encodeURIComponent(query));
}

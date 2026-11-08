// Runs after config.js and the optional config.local.js.
const SEARCH = { ...SEARCH_BASE, ...(typeof SEARCH_LOCAL !== "undefined" ? SEARCH_LOCAL : {}) };

// The URL a shortcut opens for a query (see `direct` in config.js).
function shortcutUrl(engine, query) {
  const q = query.trim();
  if (engine.direct) {
    try { if (new RegExp(engine.direct.match, "i").test(q)) return engine.direct.url.replace("%s", encodeURIComponent(q)); }
    catch { /* bad regex: fall through to search */ }
  }
  return engine.url.replace("%s", encodeURIComponent(engine.base64 ? toBase64(fillJson(engine.base64, query)) : query));
}

// `base64: '<JSON with %s>'`: the URL's %s is that JSON, filled in and base64-encoded
// (for sites that keep the search in an encoded parameter, e.g. ?table_query=...).
const fillJson = (tpl, q) => tpl.replace("%s", JSON.stringify(q).slice(1, -1));
const toBase64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

// The other way round, for past searches found in history: the query a URL value holds.
function shortcutQueryFrom(engine, value) {
  if (!engine.base64) return value;
  try {
    const json = new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)));
    const [pre, post] = engine.base64.split("%s");
    if (!json.startsWith(pre) || !json.endsWith(post)) return "";
    return JSON.parse(`"${json.slice(pre.length, json.length - post.length)}"`);
  } catch { return ""; }
}

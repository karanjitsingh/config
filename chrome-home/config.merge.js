// Runs after config.js and the optional config.local.js.
const SEARCH = { ...SEARCH_BASE, ...(typeof SEARCH_LOCAL !== "undefined" ? SEARCH_LOCAL : {}) };

// Search shortcuts: typing "<key> <query>" in the search box opens the search.
// Add private/work shortcuts in config.local.js (git-ignored) as `const SEARCH_LOCAL = { ... }`.
// Optional `direct: { match, url }`: when the whole query matches the regex (case-insensitive),
// open `direct.url` instead, e.g. a ticket ID straight to the ticket rather than a search.
const SEARCH_BASE = {
  g:  { name: "Google",  url: "https://www.google.com/search?q=%s" },
  gh: { name: "GitHub",  url: "https://github.com/search?q=%s&type=code" },
  yt: { name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
  settings: { name: "Settings", url: "chrome://settings/?search=%s" },
};

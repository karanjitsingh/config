# local/

Private, git-ignored files the extension loads when present. Everything works without them.

| File | Loaded by | For |
|---|---|---|
| `config.local.js` | new tab page | `const SEARCH_LOCAL = { key: { name, url } }`: private search shortcuts |
| `widgets.local.js` | new tab page | `registerWidget({...})` calls for private widgets |
| `background.local.js` | `src/background.js` | Background handlers a private widget needs (messages, content scripts) |
| other `*.local.js` | your own code | e.g. content scripts registered from `background.local.js` |

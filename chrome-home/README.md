# chrome-home

Chrome new tab page backed by real bookmarks (migrated from the Arc sidebar).

## Install
1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open a new tab → **Keep it** when Chrome asks
4. Optional: pin the extension's toolbar button, and set a key for it at `chrome://extensions/shortcuts`

## How it works
The page reads straight from Chrome's bookmarks, but you choose what's on it: **+ Add to page** offers **Bookmarks folder** (then pick any folder, with a filter) and each installed widget. Each one you add becomes a card in the columns. ✕ on a card removes it from the page, and the folder stays in your bookmarks.

```
Other bookmarks/
  Favorites/      → tiles at the top (pinned)
  Dashboards/     → can be added as a card
    Pipelines/    → a collapsible group inside the card (or its own card)
  Archive/        → kept at the bottom of its column
  (loose links)   → "Pages"
Bookmarks bar     → can be added as a card
```

Edit from the page, the bookmark manager, or anywhere else in Chrome; it syncs if Chrome sync is on.
Favorites, Archive, and the Bookmarks bar are matched by name/role, so they can't be renamed from the page.

## Use
- Hover a link: ☆ pin to favorites, ✎ edit, ✕ delete (with undo)
- Hover a card header: + add link, ⊞ add group, ✎ rename, ✕ remove from page. On a group: ✕ deletes the folder
- Click a section header to collapse it; drag the header to move the section to another column or position
- Columns − / + at the bottom; layout, collapsed sections, and open groups are saved (per machine)
- Drag links to reorder or move them between cards; drag onto the tiles to pin
- Drag a URL from the address bar or another page onto the page to save it
- Toolbar button: pin the current tab to Favorites or any section
- Search box works like Chrome's address bar: suggestions from history, bookmarks, and open
  tabs; inline autocomplete (`Tab`/`→` to accept, `Esc` to drop); a URL navigates, anything
  else searches with your default search engine. `↑↓` move, `Enter` open, `⌘Enter` new tab,
  `Shift+Delete` removes a history suggestion, "Switch to tab" jumps to an open page.
  Shortcuts: `code` + `Tab`/`Space`, then your query. They live in `config.js`; put private
  ones in a git-ignored `config.local.js`:
  `const SEARCH_LOCAL = { code: { name: "Code", url: "https://example.com/search?q=%s" } };`
- New tabs show the homepage with keyboard focus on the page (not the address bar). Start
  typing (or `/`, `⌘K`, `⌘V`) and an Arc-style command bar appears over a blurred homepage;
  `Esc`, deleting all the text, or clicking outside returns to the homepage. Focus works by
  re-navigating the tab to this page (falls back to reopening it in a fresh tab if needed);
  turn that off in Settings (gear in the footer).
- `/` focuses search, `Esc` clears

## Widgets

Widgets are added from **+ Add to page** and become live cards in the columns. It drags, collapses and keeps its spot like a section. Widgets register themselves through `registerWidget()` in `widgets.js`, which documents the API. Each one declares the hosts it fetches from, and Chrome asks for access when you add it. Results are cached, so a new tab paints instantly and refreshes in the background. A widget that sets `resizable: true` gets a corner grip: drag it sideways to span columns or down to set the height, and double-click it to reset.

Private widgets go in `widgets.local.js`, which is git-ignored like `config.local.js`.

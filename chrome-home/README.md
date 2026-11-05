# chrome-home

Chrome new tab page backed by real bookmarks (migrated from the Arc sidebar).

## Install
1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open a new tab → **Keep it** when Chrome asks
4. Optional: pin the extension's toolbar button, and set a key for it at `chrome://extensions/shortcuts`

## How it works
The page reads straight from Chrome's bookmarks. **Other bookmarks** is the root:

```
Other bookmarks/
  Favorites/      → tiles at the top (pinned)
  Dashboards/     → a section card
    Pipelines/    → a collapsible group inside the card
  ...             → every folder is a section
  Archive/        → collapsed section at the bottom
  (loose links)   → "Pages" section
Bookmarks bar     → its own section
```

Edit from the page, the bookmark manager, or anywhere else in Chrome; it syncs if Chrome sync is on.
Favorites, Archive, and the Bookmarks bar are matched by name/role, so they can't be renamed from the page.

## Use
- Hover a link: ☆ pin to favorites, ✎ edit, ✕ delete (with undo)
- Hover a card or group header: + add link, ⊞ add group, ✎ rename, ✕ delete
- Click a section header to collapse it; drag the header to move the section to another column or position
- Columns − / + at the bottom; layout, collapsed sections, and open groups are saved (per machine)
- Drag links to reorder or move them between cards; drag onto the tiles to pin
- Drag a URL from the address bar or another page onto the page to save it
- Toolbar button: pin the current tab to Favorites or any section
- Search box: type to filter, `↑↓` / `Enter` / `⌘Enter`; `<shortcut> <query>` to search.
  Shortcuts live in `config.js`; put private ones in a git-ignored `config.local.js`:
  `const SEARCH_LOCAL = { code: { name: "Code", url: "https://example.com/search?q=%s" } };`
- `/` focuses search, `Esc` clears

# NoteNest

A simple desktop notebook app for Windows: notebooks → sections → pages, with rich text, to-dos, search and a recycle bin. Everything is stored locally and saves automatically.

## Run it

- Use the **NoteNest** shortcut on the Desktop or in the Start menu, or
- run `dist\NoteNest-win32-x64\NoteNest.exe`.

## Where notes are stored

`%APPDATA%\NoteNest\notenest-data.json`. The previous version is kept next to it as `notenest-data.json.bak`.
Use **⋯ → Export backup** to save a copy anywhere, and **⋯ → Import backup** to restore one.

## Features

- Notebooks, colored sections and pages; rename, recolor, reorder and delete from the right-click menu
- Drag pages to reorder them, or drop them on another section to move them
- Rich text: headings, bold/italic/underline/strikethrough, highlight, font color, lists, indent, quotes, code blocks
- To-do checkboxes (Ctrl+1), links (Ctrl+K, Ctrl+click to open), pictures (insert, paste or drag in), tables, divider lines, date/time stamp
- **Pen / graphics tablet** (Draw tab): 4 pens, 1 eraser, 2 highlighters. Pens follow pen pressure; click a selected tool again to change its color and thickness. The pen's eraser end erases. Esc returns to typing, Ctrl+Z undoes ink.
- **Insert space** (Insert tab): drag down on the page to push text and ink down, drag up to remove space
- **Full screen** (F11 or ⛶): hides the notebook and page panes and brings up the pen toolbar
- Collapsible notebook pane and page pane (« buttons, ☰, View tab, Ctrl+Shift+B / Ctrl+Shift+G)
- **Export page as PDF** (View tab, ⋯ menu, or right-click a page), including handwriting
- Search across every page (Ctrl+E)
- Recycle bin: deleted pages are kept for 60 days, with Undo right after deleting
- Rule lines per page (View → Rule lines): narrow 24px, college 32px, wide 40px, extra wide 52px, or small / medium / large grid
- The page fills the available width (all of it in full screen); typed text stays in a fixed 660px column so it never reflows under handwriting
- Dark mode, print a page (Ctrl+P)

Press **⋯ → Keyboard shortcuts** inside the app for the full list.

## Develop

```bash
npm install
npm start          # run from source
npm run package    # rebuild dist\NoteNest-win32-x64
npm run installer  # rebuild the app, then dist\installer\notenest_setup.exe
```

Close NoteNest before building. Share `dist\installer\notenest_setup.exe`; it installs per user (no admin needed),
adds Start menu and Desktop shortcuts, and can be removed from Settings → Apps. Uninstalling keeps the user's notes.
The installer is not code-signed, so Windows SmartScreen asks to confirm on first run (More info → Run anyway).

`electron tools/smoke-test.js <out-dir>` runs the real app on throwaway data, toggles full screen and exports a sample ink page to PDF.
`tools/preview-server.js` serves the UI at http://localhost:5178 for testing in a browser (notes are kept in localStorage there).

# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.1] - 2026-10-14

### Fixed

- The Marketplace badge at the top of the extension page showed "retired badge" instead of the
  version. The page now also shows the install and download counts.

## [1.2.0] - 2026-10-14

Point an AI assistant at a place in a document: right-click, copy the reference, paste it into
the chat.

### Added

- **Copy Reference** in the right-click menu puts the file's path and the place under the pointer
  on the clipboard, such as `docs/report.docx, page 3, under "Regional results"`, `budget.xlsx,
  sheet "Budget", cells B4:D9` or `deck.pptx, slide 5, "Highlights"`, ready to paste into a chat
  with an AI assistant. **Copy Reference with Text** adds the selected text or what is at the
  place: the paragraph, the cells as a Markdown table, or the slide's text. Both are in the
  Command Palette too, where they describe the place in view.

## [1.1.0] - 2026-10-14

Nightdocs now runs in VS Code for the Web and opens Office templates and macro-enabled files.

### Added

- Nightdocs runs in VS Code for the Web: open Word, Excel and PowerPoint files on vscode.dev and
  github.dev with the same viewer. **Open in Office** isn't offered there, since a browser has no
  desktop app to hand a file to.
- Word, Excel and PowerPoint templates (`.dotx`, `.xltx`, `.potx`) and the remaining
  macro-enabled files (`.docm`, `.dotm`, `.xltm`, `.potm`, `.ppsm`) open in the viewer. Macros
  are never run.

### Changed

- The Marketplace listing says that Nightdocs also compares versions: "Office Viewer & Diff".

## [1.0.0] - 2026-10-14

First stable release: Nightdocs is no longer marked as a preview. Checked against hundreds of
real-world documents, it now opens large workbooks faster and says when a file is damaged.

### Added

- Audio and video embedded in presentations play, in the formats VS Code can decode.

### Changed

- No longer marked as a preview on the Marketplace.

### Fixed

- A damaged file, such as a truncated download, now says that it appears to be damaged instead
  of that something went wrong.
- Workbooks whose parts are stored with backslashes or in another letter case, which Excel
  opens, open in Nightdocs too.
- Some workbooks opened several times slower than they should: before the first view, the
  whole sheet was drawn once. A 19,000-row test workbook now opens in under a second instead
  of four to six.
- Rows and columns past Excel's limits, which only broken files have, are left out instead of
  stopping the sheet from opening, and a sheet that can't be read no longer leaves its tab
  selected over another sheet.

## [0.6.0] - 2026-10-13

More of Excel: charts are drawn, the status bar shows formulas, links in cells work, cells copy
as a Markdown table, and comparisons line up inserted and deleted columns.

### Added

- Excel charts are drawn instead of placeholders, by the same renderer as PowerPoint charts:
  in a dark theme their text, gridlines and chart area follow it while the data keeps its
  colors.
- The status bar shows the selected cell's formula after its value, as Excel's formula bar does,
  including formulas filled down or across and array formulas.
- Links in Excel cells work: <kbd>Ctrl</kbd>+click a linked cell, or click the link the status bar
  shows for it, to open a web or mail link (VS Code asks first) or go to the sheet and cells it
  points to. Hovering a linked cell shows where it goes. Links made with the `HYPERLINK` function
  work too.
- **Copy as Markdown Table** copies the selected cells of a workbook as a Markdown table, from the
  right-click menu or the Command Palette. Columns of numbers are aligned right, hidden rows and
  columns are left out, and with one cell selected it copies the block of data around it.
  Right-clicking a cell outside the selection now selects it first, as in Excel.

### Changed

- Workbook comparisons line up columns as well as rows: a column inserted or deleted is marked as
  one change, with a line where it would be on the other side, instead of marking every cell to
  its right as changed. Selecting cells and scrolling sideways follow the matching columns.

### Fixed

- Picking another sheet while a workbook was still loading the sheet a link, a comparison or a
  change led to no longer selects cells on the sheet you picked.

## [0.5.0] - 2026-10-13

Find your way around a document as in Office: a navigation pane, Go to Heading and Go to Slide,
Word comments and tracked changes, and PowerPoint speaker notes.

### Added

- A navigation pane, as in Office: Word documents show their headings as an outline that folds,
  presentations show slide thumbnails, and workbooks list their sheets. It marks where you are
  as you scroll and goes where you click. Open it from the button at the left of the toolbar or
  with **Toggle Navigation Pane**; it stays open for files of that kind, and comparisons open
  without it.
- **Go to Heading…** for Word documents and **Go to Slide…** for presentations list the headings
  or slides (by title) in VS Code's quick pick, like **Go to Sheet…** for workbooks. All three
  open with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>, VS Code's "Go to Symbol" key.
- Word documents show the current page in the status bar ("Page 3 of 13").
- Word comments and tracked changes are shown, as Word's "All Markup" does: insertions and
  deletions are marked, commented text is highlighted, and hovering its comment button shows the
  comment. The status bar lists the comments to go to, and **Markup** hides it all to read the
  text with all changes accepted. Comparisons always read the text that way.
- PowerPoint speaker notes are shown under each slide, as in PowerPoint's notes pane. **Notes** in
  the status bar hides them. Comparisons include the notes and mark what changed in them.

## [0.4.0] - 2026-10-13

Both sides of a comparison zoom together, and workbook comparisons follow the selected cell.

### Added

- Zooming one side of a comparison zooms the other side to the same level, in Word, Excel and
  PowerPoint alike.
- When comparing workbooks, selecting cells on one side selects the same cells on the other, and
  the status bar marks what changed in the selected cell. Moving to a change selects its cell.

### Changed

- Sheet tabs have a row of their own above the status bar, so a long cell text no longer squeezes
  them, and both sides of a comparison show the selected cell at the same place.

## [0.3.0] - 2026-10-13

Compare two versions of a Word, Excel or PowerPoint file side by side, straight from Source
Control.

### Added

- Compare two versions of a Word document. When VS Code compares a `.docx` file (Source Control,
  Select for Compare, the Timeline), Nightdocs shows both versions side by side, marks edited,
  added and removed paragraphs down to the changed words, and scrolls both sides together.
  <kbd>F7</kbd> / <kbd>Shift</kbd>+<kbd>F7</kbd> or the arrows in the status bar move between
  changes.
- Compare two versions of an Excel workbook the same way: changed cells and added and removed rows
  are marked, sheet tabs with changes get a dot, and moving between changes goes from sheet to
  sheet. Switching sheets or scrolling on one side moves the other side along.
- Compare two versions of a PowerPoint presentation the same way: edited slides are outlined with
  their changed words, pictures and charts marked, and added and removed slides are tinted. The
  other side shows an empty stand-in for them, so both decks line up slide for slide.
- Versions from Git open as committed. That includes Word files that Git for Windows turns into
  plain text for diffs, and files kept in Git LFS whose content is on this machine.
- **Go to Sheet…** lists every sheet of a workbook in VS Code's quick pick, where typing filters
  them. Open it with the list button next to the sheet tabs or from the Command Palette.

### Changed

- The extension is now called **Nightdocs — Office Viewer for Word, Excel & PowerPoint** in the
  Marketplace and the Extensions view. Word, Excel and PowerPoint files are registered as file
  types of their own, so searching the Marketplace by file type (`ext:docx`) finds Nightdocs.

### Fixed

- In workbooks with more sheets than fit, the sheets past the visible tabs can be reached with a
  mouse. The tabs scroll with the mouse wheel and with arrow buttons that appear when they don't
  fit, faded edges show there are more, and the current sheet's tab stays in view.
- A long cell text in the status bar no longer squeezes the sheet tabs. It is cut short, with all
  of it on hover, and narrow views such as one side of a comparison show only the cell address.

## [0.2.0] - 2026-10-12

### Added

- View PowerPoint presentations (`.pptx`, `.pptm`, `.ppsx`): text, bullets, tables, shapes,
  pictures, SmartArt and charts, with **Open in PowerPoint** to edit them.
- In dark themes slides take the editor colors like documents do. Chart text and gridlines adapt
  while data keeps its colors, so the legend still matches. Slides designed dark, or drawn on a
  picture, keep their look.
- The status bar shows the current slide, and <kbd>Page Down</kbd> / <kbd>Page Up</kbd> step from
  slide to slide. Links to other slides scroll to them.
- Hidden slides are shown dimmed with a "Hidden slide" label.

## [0.1.0] - 2026-10-12

First preview release.

### Added

- View Word documents (`.docx`) in a read-only editor: page layout, headers and footers,
  footnotes, tables, lists, images and hyperlinks.
- Documents that Word never laid out (exports from other apps, generated files) are split into
  pages of their paper size, including long tables, instead of showing as one long page.
- **Open in Word** button that hands the file to its default desktop app for editing.
- Live reload when the file changes on disk, keeping the scroll position.
- A placeholder in the shape of a page or a sheet appears while a file takes a moment to load.
- Zoom with the toolbar, <kbd>Ctrl</kbd>+<kbd>=</kbd> / <kbd>Ctrl</kbd>+<kbd>-</kbd>,
  <kbd>Ctrl</kbd>+mouse wheel or pinch; pages fit the window width by default.
- Find in document with <kbd>Ctrl</kbd>+<kbd>F</kbd>.
- Dark document colors in dark themes: pages take the editor background, text and fills are
  remapped keeping their hues with readable contrast, and pictures keep their original colors
  but are slightly dimmed so they don't glare.
  A toolbar toggle switches to the original colors; the choice is remembered.
- High contrast themes: documents and sheets aim for AAA text contrast (7:1) in the dark
  high-contrast theme, grid lines and headers are stronger, and toolbar buttons show the
  theme's outlines on hover and when pressed.
- Clear messages for empty, damaged, password-protected and legacy-format files.
- View Excel workbooks (`.xlsx`, `.xlsm`): cell styles, number and date formats (short dates
  follow your locale), merged cells, frozen panes, column widths and row heights, hidden rows,
  columns and sheets, whole-row and whole-column fills, and text that spills into empty
  neighboring cells the way it is aligned (including center across selection).
- Sheet tabs with tab colors; switch sheets with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>PgUp</kbd> /
  <kbd>PgDn</kbd>.
- Select cells with the mouse or keyboard (arrows, <kbd>Shift</kbd>, <kbd>Ctrl</kbd>+arrows,
  <kbd>PgUp</kbd>/<kbd>PgDn</kbd>, <kbd>Ctrl</kbd>+<kbd>A</kbd>), copy them as tab-separated text,
  and see Sum, Count and Average in the status bar.
- Keyboard and screen reader support: arrow keys move through the toolbar and the sheet tabs,
  every button has a name, and the document area is labeled with the file name.
- Find in sheet (<kbd>Ctrl</kbd>+<kbd>F</kbd>): searches every cell of the current sheet, not just the
  visible ones, highlights matches and steps through them with <kbd>Enter</kbd> /
  <kbd>Shift</kbd>+<kbd>Enter</kbd>.
- Pictures and text boxes in sheets are shown where Excel places them; charts appear as
  placeholders with their title and a pointer to open the file in Excel.
- Conditional formatting in sheets: highlight rules (comparisons, text, top/bottom, above or
  below average, duplicates), color scales and data bars. Rules built on custom formulas and
  icon sets are not shown yet.
- Large sheets stay smooth: workbooks are parsed in a background worker and only visible cells
  are drawn (100,000 rows open in about two seconds).
- English and Turkish user interface.

[Unreleased]: https://github.com/mbKalkan/nightdocs/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/mbKalkan/nightdocs/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/mbKalkan/nightdocs/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/mbKalkan/nightdocs/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mbKalkan/nightdocs/compare/v0.6.0...v1.0.0
[0.6.0]: https://github.com/mbKalkan/nightdocs/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/mbKalkan/nightdocs/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/mbKalkan/nightdocs/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mbKalkan/nightdocs/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mbKalkan/nightdocs/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mbKalkan/nightdocs/releases/tag/v0.1.0

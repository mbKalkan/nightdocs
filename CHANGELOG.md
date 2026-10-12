# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- View Word documents (`.docx`) in a read-only editor: page layout, headers and footers,
  footnotes, tables, lists, images and hyperlinks.
- Documents that Word never laid out (exports from other apps, generated files) are split into
  pages of their paper size, including long tables, instead of showing as one long page.
- **Open in Word** button that hands the file to its default desktop app for editing.
- Live reload when the file changes on disk, keeping the scroll position.
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

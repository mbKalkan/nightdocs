<img src="assets/icon.png" alt="" width="96" align="right">

# Nightdocs

[![CI](https://github.com/mbKalkan/nightdocs/actions/workflows/ci.yml/badge.svg)](https://github.com/mbKalkan/nightdocs/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Read Word and Excel files in VS Code, in your dark theme.**

Nightdocs is a lightweight, view-only viewer for `.docx` and `.xlsx` files. Documents take on your
editor's colors so a white page doesn't light up a dark room, and when you need to edit, one click
opens the file in Word or Excel.

> **Status:** preview. Not on the Marketplace yet.

![A Word document in Nightdocs with a dark VS Code theme](docs/images/word-dark.png)

## Why Nightdocs

- **Dark-first.** Pages, text, tables and fills are remapped to your theme. Colors keep their hue
  and text keeps readable contrast. Pictures keep their colors and are only dimmed. One click on
  ◐ shows the original colors.
- **Fast and view-only.** Files open in about a second, and sheets with 100,000 rows scroll
  smoothly. Nothing can be changed by accident.
- **Edit in Office when you need to.** **Open in Word** / **Open in Excel** hands the file to its
  desktop app. The view refreshes when the file is saved.
- **Private.** No telemetry and no network access. Your files never leave your machine.

## Features

### Word (`.docx`)

- Page layout with headers, footers, footnotes, tables, lists, images and links
- Documents that Word never paginated (exports from other apps, generated files) are split into
  pages
- Find with <kbd>Ctrl</kbd>+<kbd>F</kbd>

### Excel (`.xlsx`, `.xlsm`)

- Cell styles, number formats, and dates in your locale's short format
- Merged cells, frozen panes, hidden rows, columns and sheets, and row and column fills
- Text spills into empty neighbors the way it's aligned, including center across selection
- Conditional formatting: highlight rules, color scales and data bars
- Pictures and text boxes; charts appear as placeholders with their title
- Select cells with the mouse or keyboard, copy them, and see Sum, Count and Average
- Find across the whole sheet, not only the visible cells

![An Excel workbook in Nightdocs with conditional formatting and a selection summed in the status bar](docs/images/excel-dark.png)

### Everywhere

- Zoom with the toolbar, the keyboard, <kbd>Ctrl</kbd>+mouse wheel or pinch
- Live reload that keeps your place
- Dark, light and high contrast themes
- Keyboard and screen reader support
- English and Turkish

## Getting started

1. Install Nightdocs (Marketplace and Open VSX links will appear here at release).
2. Open a `.docx`, `.xlsx` or `.xlsm` file. Nightdocs is the default viewer for these files.

If another extension also opens these files, right-click the file and choose
**Open With… › Nightdocs**, then **Configure default editor**. Or add this to your settings:

```json
"workbench.editorAssociations": {
  "*.docx": "nightdocs.viewer",
  "*.xlsx": "nightdocs.viewer",
  "*.xlsm": "nightdocs.viewer"
}
```

## Keyboard shortcuts

| Action                | Windows / Linux                                                  | macOS                                                           |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Zoom in / out         | <kbd>Ctrl</kbd>+<kbd>=</kbd> / <kbd>Ctrl</kbd>+<kbd>-</kbd>      | <kbd>Cmd</kbd>+<kbd>=</kbd> / <kbd>Cmd</kbd>+<kbd>-</kbd>       |
| Reset zoom            | <kbd>Ctrl</kbd>+<kbd>Numpad 0</kbd>                              | <kbd>Cmd</kbd>+<kbd>Numpad 0</kbd>                              |
| Find                  | <kbd>Ctrl</kbd>+<kbd>F</kbd>                                     | <kbd>Cmd</kbd>+<kbd>F</kbd>                                     |
| Next / previous sheet | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>PgDn</kbd> / <kbd>PgUp</kbd> | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>PgDn</kbd> / <kbd>PgUp</kbd> |
| Copy selected cells   | <kbd>Ctrl</kbd>+<kbd>C</kbd>                                     | <kbd>Cmd</kbd>+<kbd>C</kbd>                                     |

## Limitations

- PowerPoint (`.pptx`) and the older binary formats (`.doc`, `.xls`) aren't supported yet.
- Password-protected files can't be opened; Nightdocs says so and offers to open them in Office.
- Excel formulas aren't recalculated: cells show the values saved in the file.
- Charts, icon sets and conditional formatting rules with custom formulas aren't drawn yet.

## Contributing

Bug reports and ideas are welcome in [issues](https://github.com/mbKalkan/nightdocs/issues).
See [CONTRIBUTING.md](CONTRIBUTING.md) to build and test the extension.

## License

[MIT](LICENSE). Third-party components and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

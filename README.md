# Nightdocs

> **Status:** early development — not yet published on the Marketplace.

A lightweight, dark-first, **view-only** viewer for Word (`.docx`) and Excel (`.xlsx`) files inside VS Code.
Need to edit? One click opens the file in your desktop Office app.

## Features

- **Word (.docx)** — page layout, images, tables, headers and footers
- **Excel (.xlsx, .xlsm)** — sheet tabs, cell styles, number and date formats, merged cells, frozen panes, pictures, find across the whole sheet, selection with Sum/Count/Average, smooth scrolling for 100,000+ rows
- **Dark-first** — documents adapt to your VS Code theme, with a one-click *Original view*
- **Open in Office** — hand the file to Word or Excel when you need to edit
- **Live reload** — the view refreshes when the file changes on disk
- **PowerPoint (.pptx)** — planned for a later release

## Privacy

No telemetry. No network access. Your documents never leave your machine.

## Development

Requires Node.js 22+.

```bash
npm install
npm run build      # bundle the extension and the webview into dist/
npm run watch      # rebuild on change
npm test           # unit tests
npm run test:visual  # browser tests of the viewer UI (Playwright)
npm run test:smoke   # end-to-end tests in a downloaded copy of VS Code
npm run fixtures   # regenerate the sample documents in test/fixtures
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm run package    # create a .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the sample documents in `test/fixtures`.

## License

[MIT](LICENSE)

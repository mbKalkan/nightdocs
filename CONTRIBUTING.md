# Contributing to Nightdocs

Thanks for your interest! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/mbKalkan/nightdocs/issues/new/choose) with:

- what you expected and what you saw (a screenshot helps a lot),
- your VS Code version, OS and color theme,
- if you can share it, a small file that shows the problem. Please remove anything private first.

## Development setup

Requires [Node.js](https://nodejs.org/) 22 or later.

```bash
npm install
npm run build        # bundle the extension and the webview into dist/
npm run watch        # rebuild on change
```

Press <kbd>F5</kbd> in VS Code to start an Extension Development Host with the sample documents
in `test/fixtures`. Alternatively, build a package with `npm run package` and install the `.vsix`
with **Extensions: Install from VSIX…**.

## Project layout

| Path                     | What lives there                                                             |
| ------------------------ | ---------------------------------------------------------------------------- |
| `src/extension/`         | Extension host: the custom editor, commands, reading files, "Open in Office" |
| `src/webview/`           | The viewer UI that runs in the webview                                       |
| `src/webview/renderers/` | One renderer per format, loaded on demand                                    |
| `src/webview/xlsx/`      | Workbook parsing (in a web worker) and the virtualized grid                  |
| `src/webview/pptx/`      | Slide navigation and chart colors around the PowerPoint renderer             |
| `src/webview/diff/`      | Comparing two versions: aligning content, marking changes, scrolling along   |
| `src/shared/`            | Code used on both sides: the message protocol, colors, zoom                  |
| `test/unit/`             | Unit tests (Vitest)                                                          |
| `test/visual/`           | Browser tests of the viewer UI (Playwright)                                  |
| `test/smoke/`            | End-to-end tests in a real copy of VS Code                                   |
| `scripts/`               | Build, fixture generation and helper scripts                                 |

The webview never touches the file system: the extension host reads the file and sends its bytes,
so remote and virtual workspaces work too. The webview runs under a strict Content Security Policy
with no network access.

## Checks

Run these before opening a pull request. CI runs the same ones.

```bash
npm run format:check # Prettier (npm run format fixes it)
npm run lint         # ESLint
npm run typecheck    # TypeScript
npm test             # unit tests
npm run test:visual  # browser tests (uses Microsoft Edge on Windows, Chromium elsewhere)
npm run test:smoke   # end-to-end tests in a downloaded copy of VS Code
```

Other useful scripts:

- `npm run fixtures` regenerates the sample documents in `test/fixtures` from code.
- `npm run fixtures:large` writes a 100,000-row workbook and a 200-slide deck for performance
  checks.
- `npm run screenshots` regenerates the images in `docs/images`.
- `npm run demo` records the README's animated demo, `docs/images/demo.gif` (needs
  [ffmpeg](https://ffmpeg.org/) and `npx playwright install ffmpeg`).
- `npm run corpus -- <folder>` opens every `.docx`, `.xlsx` and `.pptx` file in a folder and
  lists the ones that don't show, get stuck, log errors or open slowly. Use it with a collection
  of real documents, such as the test files of [Apache POI](https://github.com/apache/poi/tree/trunk/test-data);
  keep such files out of the repository.
- `npm run icon` renders `assets/icon.png` from `assets/icon.svg`.

If you change the UI, look at the screenshots the browser tests save in `test-results/screens`,
in both the dark and the light theme.

## Pull requests

- Keep each pull request to one change, and add or update tests for it.
- Write commit messages and PR titles as
  [Conventional Commits](https://www.conventionalcommits.org/) in the imperative mood:
  `feat: …`, `fix: …`, `docs: …`, `test: …`, `refactor: …`, `chore: …`, `ci: …`.
- Note user-visible changes in the `[Unreleased]` section of [CHANGELOG.md](CHANGELOG.md).
- User-facing text goes through localization: add new strings in English to `src/extension/strings.ts`
  or `package.nls.json`, and their Turkish translations to `l10n/bundle.l10n.tr.json` or
  `package.nls.tr.json`.
- New dependencies need an MIT, Apache-2.0, BSD or ISC license and an entry in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Pull requests are squash-merged once CI passes.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

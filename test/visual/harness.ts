import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { buildWebviewHtml } from '../../src/extension/webviewHtml';
import { formatForPath } from '../../src/shared/formats';
import type {
  ColorMode,
  HostToWebviewMessage,
  LoadMessage,
  ViewerStrings,
} from '../../src/shared/protocol';
import { themes, type ThemeName } from './themes';

interface Theme {
  kind: string;
  classes: readonly string[];
  variables: Record<string, string>;
}

const ORIGIN = 'http://webview.test';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

export const strings: ViewerStrings = {
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  resetZoom: 'Reset Zoom',
  showOriginalColors: 'Show Original Colors',
  showDarkColors: 'Show Dark Colors',
  openInOffice: 'Open in Word',
  openInOfficeTooltip: 'Open the file in its default desktop app to edit it',
  loading: 'Loading…',
  errorTitle: "This document can't be displayed",
  errorDamaged: "The file appears to be damaged or isn't a valid Word document.",
  errorProtectedOrLegacy:
    "The file is password-protected or uses an older binary format that isn't supported yet.",
  errorRender: 'Something went wrong while rendering this document.',
  errorRead: "The file couldn't be read.",
  errorEmpty: 'The file is empty.',
  statusCount: 'Count: {0}',
  statusSum: 'Sum: {0}',
  statusAverage: 'Average: {0}',
  formula: 'Formula',
  followLink: 'Follow Link',
  followLinkHint: '{0}+click to follow link',
  find: 'Find',
  findNoResults: 'No results',
  findCount: '{0} of {1}',
  findPrevious: 'Previous Match (Shift+Enter)',
  findNext: 'Next Match (Enter)',
  findClose: 'Close (Escape)',
  chart: 'Chart',
  chartHint: 'Open in Excel to see this chart',
  sheets: 'Sheets',
  allSheets: 'All Sheets',
  scrollSheetsLeft: 'Scroll Sheet Tabs Left',
  scrollSheetsRight: 'Scroll Sheet Tabs Right',
  goToSheet: 'Go to a sheet ({0} sheets)',
  goToSlide: 'Go to a slide ({0} slides)',
  goToHeading: 'Go to a heading ({0} headings)',
  current: 'current',
  changed: 'changed',
  page: 'Page {0}',
  pagePosition: 'Page {0} of {1}',
  comments: '{0} comments',
  oneComment: '1 comment',
  goToComment: 'Go to a comment ({0} comments)',
  commentBy: 'Comment by {0}',
  markup: 'Markup',
  showMarkup: 'Show Comments and Tracked Changes',
  hideMarkup: 'Hide Comments and Tracked Changes',
  navigationPane: 'Navigation Pane',
  headings: 'Headings',
  slides: 'Slides',
  noHeadings: 'This document has no headings.',
  close: 'Close',
  expand: 'Expand',
  collapse: 'Collapse',
  notes: 'Notes',
  speakerNotes: 'Speaker notes',
  showNotes: 'Show Speaker Notes',
  hideNotes: 'Hide Speaker Notes',
  slide: 'Slide {0}',
  slidePosition: 'Slide {0} of {1}',
  hiddenSlide: 'Hidden slide',
  noChanges: 'No changes',
  oneChange: '1 change',
  changeCount: '{0} changes',
  changePosition: 'Change {0} of {1}',
  previousChange: 'Previous Change',
  nextChange: 'Next Change',
  refPage: 'page {0}',
  refUnder: 'under "{0}"',
  refAt: 'at "{0}"',
  refSheet: 'sheet "{0}"',
  refCell: 'cell {0}',
  refCells: 'cells {0}',
  refSlide: 'slide {0}',
  refLine: 'line {0}',
  refLines: 'lines {0}-{1}',
  refProperty: 'front matter "{0}"',
  properties: 'Properties',
  showYaml: 'Show as YAML',
  showProperties: 'Show as Properties',
  frontMatterError: "The front matter isn't valid YAML: {0}",
  copyCode: 'Copy',
  copied: 'Copied',
  remoteImage: 'Picture from the web, not shown: {0}',
  onlineContentHidden: "Pictures from the web aren't shown, so nothing goes online.",
  showOnlineContent: 'Show Online Content',
  showOnlineContentHint:
    "Show this file's pictures from the web. To always show them, turn on Nightdocs › Markdown: Show Online Content.",
  missingImage: 'Picture not found: {0}',
};

/**
 * Loads the built webview (dist/webview) the way VS Code does: same HTML, same CSP,
 * a stubbed `acquireVsCodeApi`, and theme variables on the root element.
 */
export async function openViewer(
  page: Page,
  theme: ThemeName,
  /** As for Markdown views: the page may load pictures from the web (https). */
  { webPictures = false } = {},
) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

  // Pictures a Markdown file shows, read the way the extension host reads them.
  let documentDir = 'test/fixtures';
  await page.exposeFunction('__readResource', (href: string) => {
    try {
      const path = resolve(documentDir, decodeURIComponent(href.split(/[?#]/)[0]));
      const mime = extname(path) === '.svg' ? 'image/svg+xml' : `image/${extname(path).slice(1)}`;
      return { data: readFileSync(path).toString('base64'), mime };
    } catch {
      return {};
    }
  });

  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/index.html') {
      await route.fulfill({
        contentType: 'text/html',
        body: buildWebviewHtml({
          cspSource: ORIGIN,
          scriptUri: `${ORIGIN}/dist/webview/main.js`,
          styleUri: `${ORIGIN}/dist/webview/main.css`,
          lang: 'en',
          webPictures,
        }),
      });
      return;
    }
    try {
      const body = readFileSync(join(process.cwd(), path));
      await route.fulfill({ body, contentType: CONTENT_TYPES[extname(path)] });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });

  await page.addInitScript((theme) => {
    const sent: unknown[] = [];
    let state: unknown;
    // VS Code replaces all theme variables and classes on a theme change.
    const applyTheme = ({ kind, classes, variables }: typeof theme) => {
      const root = document.documentElement;
      for (const name of [...root.style]) {
        if (name.startsWith('--vscode-')) root.style.removeProperty(name);
      }
      for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
      document.body.classList.remove(
        'vscode-dark',
        'vscode-light',
        'vscode-high-contrast',
        'vscode-high-contrast-light',
      );
      document.body.classList.add(...classes);
      document.body.dataset.vscodeThemeKind = kind;
    };
    Object.assign(window, {
      __sent: sent,
      __applyTheme: applyTheme,
      acquireVsCodeApi: () => ({
        postMessage: (message: { type: string; id?: number; href?: string }) => {
          sent.push(message);
          if (message.type !== 'resource') return;
          const read = (window as unknown as Record<string, (href?: string) => Promise<unknown>>)
            .__readResource;
          void read(message.href).then((answer) => {
            const { data, mime } = answer as { data?: string; mime?: string };
            const bytes = data ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : undefined;
            const reply = { type: 'resource', id: message.id, data: bytes, mime };
            window.dispatchEvent(new MessageEvent('message', { data: reply }));
          });
        },
        getState: () => state,
        setState: (value: unknown) => (state = value),
      }),
    });
    // Init scripts run before the document exists, so theme it once parsing is done.
    document.addEventListener('DOMContentLoaded', () => applyTheme(theme));
  }, themes[theme] as Theme);

  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() =>
    (window as unknown as { __sent: { type: string }[] }).__sent.some((m) => m.type === 'ready'),
  );

  return {
    problems,
    /** Delivers a message as if it came from the extension host. Bytes travel as base64. */
    async post(message: HostToWebviewMessage) {
      const bytes = message.type === 'load' ? Buffer.from(message.data).toString('base64') : null;
      const payload: Record<string, unknown> = { ...message, data: null };
      await page.evaluate(
        ({ payload, bytes }) => {
          if (bytes !== null) {
            payload.data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
          }
          window.dispatchEvent(new MessageEvent('message', { data: payload }));
        },
        { payload, bytes },
      );
    },
    async load(
      fixture: string,
      reload = false,
      colorMode: ColorMode = 'dark',
      extra: Partial<LoadMessage> = {},
    ) {
      await this.send(join('test/fixtures', fixture), reload, colorMode, extra);
      await page.waitForSelector('.docx-wrapper, .ng-canvas, .pptx-deck, .md-page, .ov-error');
      await page.waitForSelector('.ov-progress', { state: 'hidden' });
    },
    /** Hands the viewer a file, as the extension host does, without waiting for it to show. */
    async send(
      path: string,
      reload = false,
      colorMode: ColorMode = 'dark',
      extra: Partial<LoadMessage> = {},
    ) {
      const info = formatForPath(path) ?? { format: 'docx', appName: 'Word' };
      documentDir = dirname(path);
      // Like the extension host, remember whether the navigation pane was left open.
      const sent = (await this.sent()) as { type: string; open?: boolean }[];
      const navigationPane =
        sent.filter((message) => message.type === 'setNavigationPane').pop()?.open ?? false;
      await this.post({
        type: 'load',
        fileName: basename(path),
        format: info.format,
        data: readFileSync(path),
        reload,
        canOpenInOffice: true,
        colorMode,
        navigationPane,
        locale: 'en-US',
        strings: {
          ...strings,
          openInOffice: info.format === 'md' ? 'Edit' : `Open in ${info.appName}`,
        },
        ...extra,
      });
    },
    /** Switches the theme the way VS Code does: CSS variables plus body classes. */
    async setTheme(name: ThemeName) {
      await page.evaluate(
        (theme) => (window as unknown as { __applyTheme(theme: Theme): void }).__applyTheme(theme),
        themes[name] as Theme,
      );
    },
    sent: () => page.evaluate(() => (window as unknown as { __sent: { type: string }[] }).__sent),
  };
}

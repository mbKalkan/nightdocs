import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { buildWebviewHtml } from '../../src/extension/webviewHtml';
import { formatForPath } from '../../src/shared/formats';
import type { ColorMode, HostToWebviewMessage, ViewerStrings } from '../../src/shared/protocol';
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
};

/**
 * Loads the built webview (dist/webview) the way VS Code does: same HTML, same CSP,
 * a stubbed `acquireVsCodeApi`, and theme variables on the root element.
 */
export async function openViewer(page: Page, theme: ThemeName) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

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
        postMessage: (message: unknown) => sent.push(message),
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
    async load(fixture: string, reload = false, colorMode: ColorMode = 'dark') {
      const info = formatForPath(fixture) ?? { format: 'docx', appName: 'Word' };
      await this.post({
        type: 'load',
        fileName: fixture,
        format: info.format,
        data: readFileSync(join('test/fixtures', fixture)),
        reload,
        canOpenInOffice: true,
        colorMode,
        locale: 'en-US',
        strings: { ...strings, openInOffice: `Open in ${info.appName}` },
      });
      await page.waitForSelector('.docx-wrapper, .ng-canvas, .pptx-deck, .ov-error');
      await page.waitForSelector('.ov-progress', { state: 'hidden' });
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

import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { buildWebviewHtml } from '../../src/extension/webviewHtml';
import type { ColorMode, HostToWebviewMessage, ViewerStrings } from '../../src/shared/protocol';
import { themes, type ThemeName } from './themes';

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

  const { bodyClass, variables } = themes[theme];
  await page.addInitScript(
    ({ bodyClass, variables }) => {
      const sent: unknown[] = [];
      let state: unknown;
      Object.assign(window, {
        __sent: sent,
        acquireVsCodeApi: () => ({
          postMessage: (message: unknown) => sent.push(message),
          getState: () => state,
          setState: (value: unknown) => (state = value),
        }),
      });
      // Init scripts run before the document exists, so theme it once parsing is done.
      document.addEventListener('DOMContentLoaded', () => {
        for (const [name, value] of Object.entries(variables)) {
          document.documentElement.style.setProperty(name, value);
        }
        document.body.classList.add(bodyClass);
        document.body.dataset.vscodeThemeKind = bodyClass;
      });
    },
    { bodyClass, variables },
  );

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
      await this.post({
        type: 'load',
        fileName: fixture,
        format: 'docx',
        data: readFileSync(join('test/fixtures', fixture)),
        reload,
        canOpenInOffice: true,
        colorMode,
        strings,
      });
      await page.waitForSelector('.docx-wrapper, .ov-error');
      await page.waitForSelector('.ov-progress', { state: 'hidden' });
    },
    /** Switches the theme the way VS Code does: CSS variables plus body classes. */
    async setTheme(name: ThemeName) {
      const { bodyClass, variables } = themes[name];
      await page.evaluate(
        ({ bodyClass, variables }) => {
          for (const [variable, value] of Object.entries(variables)) {
            document.documentElement.style.setProperty(variable, value);
          }
          document.body.classList.remove('vscode-dark', 'vscode-light');
          document.body.classList.add(bodyClass);
          document.body.dataset.vscodeThemeKind = bodyClass;
        },
        { bodyClass, variables },
      );
    },
    sent: () => page.evaluate(() => (window as unknown as { __sent: { type: string }[] }).__sent),
  };
}

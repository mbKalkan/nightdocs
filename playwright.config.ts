import { defineConfig } from '@playwright/test';

// Renders the webview bundle in a browser with VS Code theme variables, for screenshots
// and end-to-end checks of the viewer UI. Uses the system Edge on Windows to avoid a download.
// Measures CSS `zoom` as VS Code's desktop app does: it turns the browsers' standard off.
export default defineConfig({
  testDir: 'test/visual',
  outputDir: 'test-results/visual',
  reporter: 'list',
  use: {
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    viewport: { width: 1100, height: 760 },
    launchOptions: { args: ['--disable-blink-features=StandardizedBrowserZoom'] },
  },
});

import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const pageBackground = (page: Page) =>
  page
    .locator('.ov-content .docx-wrapper > section.docx')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test.describe(`${theme} theme`, () => {
    test('renders a Word document', async ({ page }) => {
      const viewer = await openViewer(page, theme);
      await viewer.load('sample.docx');

      await expect(page.locator('.docx-wrapper > section.docx')).toHaveCount(2);
      await expect(page.locator('.ov-file-name')).toHaveText('sample.docx');
      await expect(page.locator('.ov-zoom-label')).toHaveText('100%');
      await expect(page.locator('img')).toHaveCount(1);
      await page.screenshot({ path: `${SCREENS}/sample-${theme}.png` });
      expect(viewer.problems).toEqual([]);
    });

    test('explains a file it cannot open', async ({ page }) => {
      const viewer = await openViewer(page, theme);
      await viewer.load('protected.docx');

      await expect(page.locator('.ov-error-title')).toHaveText("This document can't be displayed");
      await expect(page.locator('.ov-error-message')).toContainText('password-protected');
      await expect(page.locator('.ov-error .ov-button')).toHaveText('Open in Word');
      await page.screenshot({ path: `${SCREENS}/protected-${theme}.png` });
      expect(viewer.problems).toEqual([]);
    });
  });
}

test('shows documents with dark colors in dark themes', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');

  expect(await pageBackground(page)).toBe('rgb(31, 31, 31)');
  expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator('[data-action="colors"]')).toBeVisible();
  await expect(page.locator('[data-action="colors"]')).toHaveAttribute('aria-pressed', 'true');
  // Pictures keep their own colors and are only dimmed.
  expect(await page.locator('img').getAttribute('style')).not.toMatch(/color|filter/);
  expect(await page.locator('img').evaluate((el) => getComputedStyle(el).filter)).toBe(
    'brightness(0.8)',
  );
});

test('asks for AAA text contrast in the dark high-contrast theme', async ({ page }) => {
  const viewer = await openViewer(page, 'hcDark');
  await viewer.load('sample.docx');

  expect(await pageBackground(page)).toBe('rgb(0, 0, 0)');
  expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(7);
  // The pressed colors toggle has no background here, so it shows a border instead.
  const toggle = page.locator('[data-action="colors"]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await toggle.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(
    'rgb(111, 195, 223)',
  );
});

test('switches between dark and original colors', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');
  const toggle = page.locator('[data-action="colors"]');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await pageBackground(page)).toBe('rgb(255, 255, 255)');
  expect(await page.locator('img').evaluate((el) => getComputedStyle(el).filter)).toBe('none');
  expect(await viewer.sent()).toContainEqual({ type: 'setColorMode', mode: 'original' });
  await page.screenshot({ path: `${SCREENS}/sample-dark-original.png` });

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await pageBackground(page)).toBe('rgb(31, 31, 31)');
});

test('respects the remembered original-colors choice', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx', false, 'original');

  expect(await pageBackground(page)).toBe('rgb(255, 255, 255)');
  await expect(page.locator('[data-action="colors"]')).toHaveAttribute('aria-pressed', 'false');
});

test('keeps original colors in light themes', async ({ page }) => {
  const viewer = await openViewer(page, 'light');
  await viewer.load('sample.docx');

  expect(await pageBackground(page)).toBe('rgb(255, 255, 255)');
  await expect(page.locator('[data-action="colors"]')).toBeHidden();
});

test('follows a theme change while open', async ({ page }) => {
  const viewer = await openViewer(page, 'light');
  await viewer.load('sample.docx');
  expect(await pageBackground(page)).toBe('rgb(255, 255, 255)');

  await viewer.setTheme('dark');
  await expect.poll(() => pageBackground(page)).toBe('rgb(31, 31, 31)');
  await viewer.setTheme('light');
  await expect.poll(() => pageBackground(page)).toBe('rgb(255, 255, 255)');
});

for (const [fixture, chunk, selector] of [
  ['sample.docx', 'docx', '.docx-wrapper'],
  ['sample.xlsx', 'xlsx', '.ng-canvas'],
  ['sample.pptx', 'pptx', '.pptx-deck'],
] as const) {
  test(`shows a placeholder while a slow ${chunk} file loads`, async ({ page }) => {
    const viewer = await openViewer(page, 'dark');
    // Hold back the renderer so loading takes a while.
    await page.route(`**/dist/webview/chunks/${chunk}-*.js`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fallback();
    });
    const loading = viewer.load(fixture);

    const skeleton = page.locator('.ov-skeleton');
    await expect.poll(() => skeleton.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.screenshot({ path: `${SCREENS}/skeleton-${chunk}.png` });
    await loading;
    await expect(page.locator(selector)).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    expect(viewer.problems).toEqual([]);
  });
}

test('reports damaged files', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('damaged.docx');
  await expect(page.locator('.ov-error-message')).toContainText('damaged');
});

test('fits wide pages into a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 700 });
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');

  const label = await page.locator('.ov-zoom-label').textContent();
  expect(parseInt(label ?? '', 10)).toBeLessThan(100);
  await page.screenshot({ path: `${SCREENS}/narrow-dark.png` });
});

test('can be used from the keyboard and a screen reader', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');

  // Every toolbar button has a name; the zoom label is named by its percentage.
  await expect(page.getByRole('button', { name: 'Zoom Out' })).toBeVisible();
  await expect(page.getByRole('button', { name: '100%' })).toHaveAttribute('title', 'Reset Zoom');
  await expect(page.getByRole('main', { name: 'sample.docx' })).toBeVisible();

  // Arrow keys move through the toolbar and wrap around.
  await page.locator('[data-action="colors"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-action="zoom-out"]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('[data-action="open"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-action="colors"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-action="open"]')).toBeFocused();
});

test('zooms with toolbar buttons and host commands', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');
  const label = page.locator('.ov-zoom-label');

  await page.locator('[data-action="zoom-in"]').click();
  await expect(label).toHaveText('110%');
  await viewer.post({ type: 'zoom', action: 'in' });
  await expect(label).toHaveText('125%');
  await viewer.post({ type: 'zoom', action: 'reset' });
  await expect(label).toHaveText('100%');
  await page.locator('[data-action="zoom-out"]').click();
  await expect(label).toHaveText('90%');

  await page.mouse.move(500, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(label).not.toHaveText('90%');
});

test('splits documents Word never paginated into pages', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  // Generated without Word's page break marks: docx-preview alone shows one long page.
  await viewer.load('long.docx');

  const pages = page.locator('.docx-wrapper > section.docx');
  expect(await pages.count()).toBeGreaterThan(8);
  const heights = await pages.evaluateAll((sections) =>
    sections.map((section) => section.getBoundingClientRect().height),
  );
  // Every page keeps its paper size and repeats the running header.
  expect(new Set(heights.map(Math.round)).size).toBe(1);
  await expect(page.locator('.docx-wrapper > section.docx > header')).toHaveCount(heights.length);
  await expect(page.locator('.docx-wrapper > section.docx > footer')).toHaveCount(heights.length);
  // The long table continues on the next page, with every row kept once.
  const tables = page.locator('.docx-wrapper > section.docx > article > table');
  expect(await tables.count()).toBeGreaterThan(1);
  expect(
    await tables.evaluateAll((all) =>
      all.reduce((sum, t) => sum + (t as HTMLTableElement).rows.length, 0),
    ),
  ).toBe(61);
  await expect(
    page.locator('.docx-wrapper > section.docx > article > table:first-child', {
      hasText: 'Week',
    }),
  ).not.toHaveCount(0);

  // Pages Word laid out stay as they are.
  await viewer.load('sample.docx');
  await expect(pages).toHaveCount(2);
});

test('keeps the scroll position when the file changes on disk', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('long.docx');
  const viewport = page.locator('.ov-viewport');

  await viewport.evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
  const before = await viewport.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(1000);
  await viewer.load('long.docx', true);
  const after = await viewport.evaluate((el) => el.scrollTop);

  expect(Math.abs(after - before)).toBeLessThan(5);
  await page.screenshot({ path: `${SCREENS}/long-dark.png` });
});

test('keeps the last good render when a reload fails mid-save', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');
  await viewer.load('damaged.docx', true);

  await expect(page.locator('.docx-wrapper')).toBeVisible();
  await expect(page.locator('.ov-error')).toHaveCount(0);
});

test('asks the host to open the file in Office', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');

  await page.locator('.ov-toolbar [data-action="open"]').click();
  expect(await viewer.sent()).toContainEqual({ type: 'openInOffice' });
});

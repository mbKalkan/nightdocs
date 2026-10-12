import { expect, test } from '@playwright/test';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

for (const theme of ['dark', 'light'] as ThemeName[]) {
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

import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const pageBackground = (page: Page) =>
  page
    .locator('.ov-content .docx-wrapper > section.docx')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);

/**
 * Lowest WCAG contrast between any text and the opaque background behind it, measured from
 * computed styles in the page.
 */
const lowestTextContrast = (page: Page) =>
  page.evaluate(() => {
    const parse = (value: string) => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(value);
      return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : undefined;
    };
    const luminance = ([r, g, b]: number[]) => {
      const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const backgroundOf = (el: Element | null): number[] => {
      for (let node = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg.a >= 0.5) return bg.rgb;
      }
      return [255, 255, 255];
    };
    let lowest = Infinity;
    const walker = document.createTreeWalker(
      document.querySelector('.ov-content') as Node,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || el.tagName === 'STYLE' || !node.textContent?.trim()) continue;
      const fg = parse(getComputedStyle(el).color);
      if (!fg) continue;
      const [a, b] = [luminance(fg.rgb), luminance(backgroundOf(el))].sort((x, y) => y - x);
      lowest = Math.min(lowest, (a + 0.05) / (b + 0.05));
    }
    return lowest;
  });

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

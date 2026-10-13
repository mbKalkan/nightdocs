import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const slides = (page: Page) => page.locator('.pptx-slide');
const status = (page: Page) => page.locator('.ov-status');

/** Background of a slide as drawn, from the renderer's slide element inside our frame. */
const slideBackground = (page: Page, index: number) =>
  slides(page)
    .nth(index)
    .evaluate((frame) => getComputedStyle(frame.firstElementChild as Element).backgroundColor);

/** Distance from the top of the viewport to the top of a slide, in screen pixels. */
const slideOffset = (page: Page, index: number) =>
  slides(page)
    .nth(index)
    .evaluate((frame) => {
      const viewport = document.querySelector('.ov-viewport') as HTMLElement;
      return frame.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    });

/** Light themes show slides as authored, so text contrast is only checked in dark ones. */
const EXPECTED: Record<ThemeName, { page: string; contrast?: number }> = {
  dark: { page: 'rgb(31, 31, 31)', contrast: 4.5 },
  hcDark: { page: 'rgb(0, 0, 0)', contrast: 7 },
  light: { page: 'rgb(255, 255, 255)' },
  hcLight: { page: 'rgb(255, 255, 255)' },
};

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`renders a presentation in the ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.pptx');

    await expect(slides(page)).toHaveCount(8);
    await expect(page.locator('.ov-file-name')).toHaveText('sample.pptx');
    await expect(page.getByRole('button', { name: 'Open in PowerPoint' })).toBeVisible();
    await expect(status(page)).toHaveText('Slide 1 of 8');
    await expect(page.locator('.pptx-slide canvas')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Slide 8, Hidden slide' })).toBeAttached();
    await page.screenshot({ path: `${SCREENS}/presentation-${theme}.png` });

    expect(await slideBackground(page, 0)).toBe(EXPECTED[theme].page);
    // Slides designed dark keep their background in every theme.
    expect(await slideBackground(page, 5)).toBe('rgb(27, 27, 47)');
    const { contrast } = EXPECTED[theme];
    if (contrast) expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(contrast);
    expect(viewer.problems).toEqual([]);
  });
}

test('keeps slides drawn on a picture in their original colors', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');

  const pictureSlide = slides(page).nth(6);
  await expect(pictureSlide).toHaveAttribute('data-colors', 'original');
  const title = pictureSlide.getByText('Picture background');
  expect(await title.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(27, 27, 47)');
  await pictureSlide.screenshot({ path: `${SCREENS}/presentation-picture-dark.png` });
});

test('shows the original slide colors on request', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');
  expect(await slideBackground(page, 0)).toBe('rgb(31, 31, 31)');

  await page.locator('[data-action="colors"]').click();
  await expect.poll(() => slideBackground(page, 0)).toBe('rgb(255, 255, 255)');
  await expect(status(page)).toHaveText('Slide 1 of 8');
});

test('adapts chart text to dark themes and keeps the data colors', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');
  const chartSlide = slides(page).nth(3);

  // The chart title, black in the file, turns light; the bars keep their colors, so they
  // still match the legend (the top of the West Q3 bar, just under the 1,600 grid line).
  /** Brightest pixel and average color of an area of the chart, in CSS pixels. */
  const sample = (x: number, y: number, width: number, height: number) =>
    chartSlide
      .locator('canvas')
      .first()
      .evaluate(
        (canvas: HTMLCanvasElement, box) => {
          const context = canvas.getContext('2d') as CanvasRenderingContext2D;
          const scale = canvas.width / canvas.getBoundingClientRect().width;
          const { data } = context.getImageData(
            box.x * scale,
            box.y * scale,
            box.width * scale,
            box.height * scale,
          );
          let brightest = 0;
          const sum = [0, 0, 0];
          for (let i = 0; i < data.length; i += 4) {
            brightest = Math.max(brightest, (data[i] + data[i + 1] + data[i + 2]) / 3);
            for (let c = 0; c < 3; c++) sum[c] += data[i + c];
          }
          return { brightest, average: sum.map((value) => Math.round(value / (data.length / 4))) };
        },
        { x, y, width, height },
      );
  expect((await sample(180, 10, 180, 40)).brightest).toBeGreaterThan(150);
  const [red, green, blue] = (await sample(470, 98, 20, 10)).average;
  expect(red).toBeGreaterThan(200);
  expect(green).toBeLessThan(150);
  expect(blue).toBeLessThan(90);
  await chartSlide.scrollIntoViewIfNeeded();
  await chartSlide.screenshot({ path: `${SCREENS}/presentation-chart-dark.png` });
});

test('pages through slides with Page Up and Page Down', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');
  await page.locator('.ov-viewport').focus();

  await page.keyboard.press('PageDown');
  await expect(status(page)).toHaveText('Slide 2 of 8');
  expect(await slideOffset(page, 1)).toBeCloseTo(12, 0);

  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  await expect(status(page)).toHaveText('Slide 4 of 8');
  await page.keyboard.press('PageUp');
  await expect(status(page)).toHaveText('Slide 3 of 8');
  expect(await slideOffset(page, 2)).toBeCloseTo(12, 0);
});

test('follows links to other slides', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');

  await page.getByText('Details are on the regional results slide').click();
  await expect(status(page)).toHaveText('Slide 3 of 8');
  expect(await slideOffset(page, 2)).toBeCloseTo(12, 0);
});

test('stays on the same slide when the file changes', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');
  await page.locator('.ov-viewport').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('PageDown');
  await expect(status(page)).toHaveText('Slide 4 of 8');

  await viewer.load('sample.pptx', true);
  await expect(status(page)).toHaveText('Slide 4 of 8');
});

test('fits slides into a narrow window and pages at that size', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 700 });
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');

  const label = await page.locator('.ov-zoom-label').textContent();
  expect(parseInt(label ?? '', 10)).toBeLessThan(60);
  await page.locator('.ov-viewport').focus();
  await page.keyboard.press('PageDown');
  await expect(status(page)).toHaveText('Slide 2 of 8');
  expect(await slideOffset(page, 1)).toBeCloseTo(12, 0);
  await page.screenshot({ path: `${SCREENS}/presentation-narrow-dark.png` });
});

test('shows speaker notes under their slides, and hides them on request', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');
  const notes = page.locator('.pptx-notes');
  await expect(notes).toHaveCount(2);
  await expect(notes.first()).toHaveText(
    'Mention the support backlog numbers.\nKeep this under two minutes.',
    { useInnerText: true },
  );
  // Each under its own slide: Highlights, and the dark slide.
  const slides = await notes.evaluateAll((elements) =>
    elements.map((element) => element.previousElementSibling?.getAttribute('aria-label')),
  );
  expect(slides).toEqual(['Slide 2', 'Slide 6']);

  const toggle = page.getByRole('button', { name: 'Notes' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(notes.first()).toBeHidden();
  await expect(toggle).toHaveAttribute('title', 'Show Speaker Notes');

  // The choice stays when the file changes.
  await viewer.load('sample.pptx', true);
  await expect(page.locator('.pptx-notes').first()).toBeHidden();
  await expect(page.getByRole('button', { name: 'Notes' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(viewer.problems).toEqual([]);
});

test('has no notes switch for a deck without notes', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('long.pptx');
  await expect(page.locator('.ov-status')).toHaveText('Slide 1 of 30');
  await expect(page.getByRole('button', { name: 'Notes' })).toHaveCount(0);
});

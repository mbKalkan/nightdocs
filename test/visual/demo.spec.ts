import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

// Records the short demo shown at the top of the README. Not part of the test run:
// `npm run demo` records it and turns it into docs/images/demo.gif.
test.skip(!process.env.DEMO_VIDEO, 'run with npm run demo');
test.use({
  viewport: { width: 1000, height: 640 },
  deviceScaleFactor: 1,
  video: { mode: 'on', size: { width: 1000, height: 640 } },
});

/** Moves the mouse to an element and clicks it, slowly enough to follow. */
async function clickSlowly(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('demo', async ({ page }) => {
  test.setTimeout(120_000);
  const viewer = await openViewer(page, 'dark');

  // A Word document in the dark theme, then as authored, and back.
  await viewer.load('sample.docx');
  await page.waitForTimeout(1500);
  await clickSlowly(page, '[data-action="colors"]');
  await page.waitForTimeout(1500);
  await clickSlowly(page, '[data-action="colors"]');
  await page.waitForTimeout(1000);

  // A workbook: select cells for their sum, then its charts.
  await viewer.load('sample.xlsx');
  await page.waitForTimeout(800);
  const cell = async (column: string, row: number) => {
    const col = (await page
      .locator('.ng-hc', { hasText: new RegExp(`^${column}$`) })
      .boundingBox())!;
    const header = (await page
      .locator('.ng-hr', { hasText: new RegExp(`^${row}$`) })
      .boundingBox())!;
    return { x: col.x + col.width / 2, y: header.y + header.height / 2 };
  };
  const from = await cell('B', 3);
  const to = await cell('C', 8);
  await page.mouse.move(from.x, from.y, { steps: 12 });
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.ov-status')).toContainText('Sum');
  await page.waitForTimeout(1500);
  await clickSlowly(page, '.ov-sheet-tab:has-text("Charts")');
  await expect(page.locator('.ng-chart-box canvas').first()).toBeVisible();
  await page.waitForTimeout(1800);

  // A presentation with its slide pane.
  await viewer.load('sample.pptx');
  await page.waitForTimeout(600);
  await clickSlowly(page, '[data-action="navigation"]');
  await page.waitForTimeout(800);
  for (const index of [3, 4]) {
    await clickSlowly(page, `.ov-nav-item >> nth=${index}`);
    await page.waitForTimeout(1300);
  }
});

import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openViewer } from './harness';

// Screenshots for the README and the Marketplace page. Not part of the test run:
// `npm run screenshots` regenerates docs/images.
const OUT = 'docs/images';

test.skip(!process.env.README_SCREENSHOTS, 'run with npm run screenshots');
test.use({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

test('Word document in a dark theme', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');
  await page.screenshot({ path: `${OUT}/word-dark.png` });
});

test('Word document with its original colors', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx', false, 'original');
  await page.screenshot({ path: `${OUT}/word-original.png` });
});

test('Excel workbook in a dark theme', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  // Select Q2 and Q3 so the status bar shows Sum, Count and Average.
  const cell = async (column: string, row: number) => {
    const col = await page.locator('.ng-hc', { hasText: new RegExp(`^${column}$`) }).boundingBox();
    const header = await page.locator('.ng-hr', { hasText: new RegExp(`^${row}$`) }).boundingBox();
    return { x: col!.x + col!.width / 2, y: header!.y + header!.height / 2 };
  };
  const from = await cell('B', 3);
  const to = await cell('C', 8);
  await page.mouse.click(from.x, from.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(to.x, to.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('.ov-status')).toContainText('Sum');
  await page.screenshot({ path: `${OUT}/excel-dark.png` });
});

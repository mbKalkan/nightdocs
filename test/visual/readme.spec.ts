import { mkdirSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';
import type { CellSelection } from '../../src/shared/protocol';
import { lastSent, openComparison, relayScroll } from './comparison';
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

test('PowerPoint presentation in a dark theme', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');
  // The chart slide shows the most: adapted text, kept data colors and the slide counter.
  await page.locator('.ov-viewport').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('PageDown');
  await expect(page.locator('.ov-status')).toHaveText('Slide 4 of 8');
  await page.locator('.ov-viewport').blur();
  await page.screenshot({ path: `${OUT}/powerpoint-dark.png` });
});

/** Shoots two versions side by side with a one-pixel divider, like VS Code's diff editor. */
async function comparisonShot(
  context: BrowserContext,
  files: [string, string],
  image: string,
  change = 1,
): Promise<void> {
  const [original, modified] = await openComparison(
    [await context.newPage(), await context.newPage()],
    'dark',
    files,
    600,
  );
  // The modified side opens at its first change; the original follows, as in VS Code.
  await expect.poll(() => lastSent(modified.viewer, 'scroll')).toBeTruthy();
  for (let position = 2; position <= change; position++) {
    await modified.page.keyboard.press('F7');
    await expect(modified.page.locator('.ov-diff-status')).toHaveText(
      new RegExp(`^Change ${position} of`),
    );
  }
  await modified.page.waitForTimeout(200);
  await relayScroll(modified, original);
  // A workbook selects the changed cell; the other side selects it too.
  const selected = await lastSent<{ selection: CellSelection }>(modified.viewer, 'select');
  if (selected) await original.viewer.post({ type: 'peerSelect', selection: selected.selection });
  await original.page.waitForTimeout(200);
  const shots = await Promise.all([original.page.screenshot(), modified.page.screenshot()]);

  const page = await context.newPage();
  await page.setViewportSize({ width: 1201, height: 760 });
  const images = shots.map(
    (shot) => `<img src="data:image/png;base64,${shot.toString('base64')}">`,
  );
  await page.setContent(
    `<body style="margin:0;display:flex;gap:1px;background:#2b2b2b">${images.join('')}</body>`,
  );
  await page.screenshot({ path: `${OUT}/${image}` });
}

test('Word comparison in a dark theme', async ({ context }) => {
  await comparisonShot(context, ['sample.docx', 'sample-revised.docx'], 'word-compare-dark.png');
});

test('Excel comparison in a dark theme', async ({ context }) => {
  await comparisonShot(context, ['orders.xlsx', 'orders-revised.xlsx'], 'excel-compare-dark.png');
});

test('PowerPoint comparison in a dark theme', async ({ context }) => {
  // The changed chart above the added slide, and the stand-in for it on the other side.
  await comparisonShot(
    context,
    ['sample.pptx', 'sample-revised.pptx'],
    'powerpoint-compare-dark.png',
    3,
  );
});

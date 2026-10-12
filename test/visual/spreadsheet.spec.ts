import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

const SCREENS = 'test-results/screens';

/** Center of a cell on screen, located through its row and column headers. */
async function cellCenter(page: Page, column: string, row: number) {
  const col = await page
    .locator('.ng-hc', { hasText: new RegExp(`^${column}$`) })
    .first()
    .boundingBox();
  const header = await page
    .locator('.ng-hr', { hasText: new RegExp(`^${row}$`) })
    .first()
    .boundingBox();
  if (!col || !header) throw new Error(`Cell ${column}${row} is not on screen`);
  return { x: col.x + col.width / 2, y: header.y + header.height / 2 };
}

async function clickCell(page: Page, column: string, row: number, modifiers: 'Shift'[] = []) {
  const { x, y } = await cellCenter(page, column, row);
  if (modifiers.length) await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  if (modifiers.length) await page.keyboard.up('Shift');
}

const status = (page: Page) => page.locator('.ov-status');
const activeTab = (page: Page) => page.locator('.ov-sheet-tab[aria-selected="true"]');

/** Text the viewer puts on the clipboard for the current selection. */
const copied = (page: Page) =>
  page.evaluate(() => {
    const data = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data }));
    return data.getData('text/plain');
  });

for (const theme of ['dark', 'light'] as const) {
  test(`renders a workbook in the ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.xlsx');

    await expect(page.locator('.ov-sheet-tab')).toHaveText(['Budget', 'Data', 'No Grid', 'Charts']);
    await expect(activeTab(page)).toHaveText('Budget');
    await expect(page.locator('.ng-c', { hasText: 'Q3 Budget Overview' }).first()).toBeVisible();
    await expect(page.locator('.ng-c', { hasText: '-4.1%' })).toBeVisible();
    await expect(page.locator('.ng-c', { hasText: '$1,234.50' })).toBeVisible();
    await expect(page.locator('.ng-c', { hasText: '10/15/2024' })).toBeVisible();
    await expect(page.locator('.ng-c', { hasText: /^#+$/ })).toBeVisible();
    await expect(status(page)).toContainText('A1');
    await page.screenshot({ path: `${SCREENS}/xlsx-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`draws pictures, chart placeholders and text boxes in the ${theme} theme`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.xlsx');
    await page.locator('.ov-sheet-tab', { hasText: 'Charts' }).click();

    const charts = page.locator('.ng-main .ng-chart');
    await expect(charts.first()).toContainText('Q3 revenue by region');
    await expect(charts.first()).toContainText('Open in Excel to see this chart');
    await expect(charts.nth(1).locator('.ng-chart-title')).toHaveText('Chart');
    await expect(page.locator('.ng-shape')).toContainText('are drawn over the grid.');
    const picture = page.locator('.ng-main .ng-pic').first();
    await expect
      .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBe(480);
    // The picture crosses the frozen row, so the frozen pane draws its top part.
    await expect(page.locator('.ng-top .ng-pic')).toHaveCount(1);
    await page.screenshot({ path: `${SCREENS}/xlsx-drawings-${theme}.png` });
    if (theme === 'dark') {
      await page.locator('.ov-viewport').evaluate((el) => (el.scrollTop = 100));
      await page.screenshot({ path: `${SCREENS}/xlsx-drawings-scrolled.png` });
    }
    expect(viewer.problems).toEqual([]);
  });
}

test('grows a sheet to show drawings past its data', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  await page.locator('.ov-sheet-tab', { hasText: 'Charts' }).click();
  await expect(page.locator('.ng-main .ng-chart').first()).toBeVisible();

  await page.locator('.ov-viewport').evaluate((el) => el.scrollTo(el.scrollWidth, el.scrollHeight));
  await expect(page.locator('.ng-main .ng-pic')).toHaveCount(1);
  await expect(page.locator('.ng-main .ng-pic')).toBeInViewport();
});

test('shows the original workbook colors on request', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx', false, 'original');
  const sheet = await page
    .locator('.ng-host')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(sheet).toBe('rgb(255, 255, 255)');
  await page.screenshot({ path: `${SCREENS}/xlsx-dark-original.png` });
});

test('selects cells and sums ranges in the status bar', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');

  await clickCell(page, 'B', 3);
  await expect(status(page)).toContainText('B3');
  await expect(status(page)).toContainText('1,240');

  await clickCell(page, 'C', 5, ['Shift']);
  await expect(status(page)).toContainText('B3:C5');
  await expect(status(page)).toContainText('Sum: 6,782');
  await expect(status(page)).toContainText('Count: 6');
  await expect(status(page)).toContainText('Average: 1,130.333');
  expect(await copied(page)).toBe('1,240\t1,385\n980\t1,012\n1,105\t1,060');
});

test('moves the selection with the keyboard', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  await clickCell(page, 'A', 3);

  await page.keyboard.press('ArrowRight');
  await expect(status(page)).toContainText('B3');
  // Column B is filled from row 3 to 14, so Ctrl+Down jumps to the end of that block.
  await page.keyboard.press('Control+ArrowDown');
  await expect(status(page)).toContainText('B14');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(status(page)).toContainText('B13:B14');
});

test('zooms the grid and keeps clicks on the right cell', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  await expect(page.locator('.ov-zoom-label')).toHaveText('100%');

  await page.locator('[data-action="zoom-in"]').click();
  await page.locator('[data-action="zoom-in"]').click();
  await expect(page.locator('.ov-zoom-label')).toHaveText('125%');
  await clickCell(page, 'C', 6);
  await expect(status(page)).toContainText('C6');

  for (let i = 0; i < 4; i++) await page.locator('[data-action="zoom-out"]').click();
  await expect(page.locator('.ov-zoom-label')).toHaveText('80%');
  await clickCell(page, 'E', 8);
  await expect(status(page)).toContainText('E8');
  await page.screenshot({ path: `${SCREENS}/xlsx-zoom-80.png` });
});

test('switches sheets and keeps frozen headers in view', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');

  await page.locator('.ov-sheet-tab', { hasText: 'Data' }).click();
  await expect(activeTab(page)).toHaveText('Data');
  await expect(page.locator('.ng-c', { hasText: 'Revenue' })).toBeVisible();

  await page.locator('.ov-viewport').evaluate((el) => (el.scrollTop = 20_000));
  await expect(page.locator('.ng-hr', { hasText: /^1000$/ })).toBeVisible();
  // The frozen header row stays on screen while scrolled.
  const header = await page.locator('.ng-top .ng-c', { hasText: 'Revenue' }).boundingBox();
  const viewport = await page.locator('.ov-viewport').boundingBox();
  expect(header!.y - viewport!.y).toBeLessThan(45);
  await page.screenshot({ path: `${SCREENS}/xlsx-data-scrolled.png` });

  await viewer.post({ type: 'command', command: 'nextSheet' });
  await expect(activeTab(page)).toHaveText('No Grid');
  await expect(page.locator('.ng-canvas')).toHaveClass(/ng-no-lines/);
  await viewer.post({ type: 'command', command: 'previousSheet' });
  await expect(activeTab(page)).toHaveText('Data');
});

test('keeps the sheet and selection when the file changes on disk', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  await page.locator('.ov-sheet-tab', { hasText: 'Data' }).click();
  await expect(page.locator('.ng-c', { hasText: 'Revenue' })).toBeVisible();
  await clickCell(page, 'C', 4);

  await viewer.load('sample.xlsx', true);
  await expect(activeTab(page)).toHaveText('Data');
  await expect(status(page)).toContainText('C4');
});

test('finds text anywhere in the sheet, not only on screen', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  await page.locator('.ov-sheet-tab', { hasText: 'Data' }).click();
  await expect(page.locator('.ng-c', { hasText: 'Revenue' })).toBeVisible();

  await viewer.post({ type: 'command', command: 'find' });
  const input = page.locator('.ov-find-input');
  await expect(input).toBeFocused();
  // ID 1999 is far below the visible rows.
  await input.fill('1999');
  await input.press('Enter');
  await expect(page.locator('.ov-find-count')).toHaveText('1 of 1');
  await expect(status(page)).toContainText('A2000');
  await expect(page.locator('.ng-found', { hasText: '1999' })).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/xlsx-find.png` });

  await input.fill('enterprise');
  await input.press('Enter');
  await expect(page.locator('.ov-find-count')).toHaveText(/^1 of \d+$/);
  await input.press('Enter');
  await expect(page.locator('.ov-find-count')).toHaveText(/^2 of \d+$/);
  await input.press('Shift+Enter');
  await expect(page.locator('.ov-find-count')).toHaveText(/^1 of \d+$/);

  await input.fill('no such text');
  await input.press('Enter');
  await expect(page.locator('.ov-find-count')).toHaveText('No results');

  await input.press('Escape');
  await expect(page.locator('.ov-find')).toBeHidden();
  await expect(page.locator('.ng-found')).toHaveCount(0);
});

test('explains a protected workbook', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('protected.xlsx');
  await expect(page.locator('.ov-error-message')).toContainText('password-protected');
  await expect(page.locator('.ov-error .ov-button')).toHaveText('Open in Excel');
  await expect(page.locator('.ov-footer')).toBeHidden();
});

test('opens a 100,000-row workbook and scrolls to the end', async ({ page }) => {
  test.skip(!existsSync('test/fixtures/generated/large.xlsx'), 'run npm run fixtures:large first');
  test.setTimeout(90_000);
  const viewer = await openViewer(page, 'dark');
  const started = Date.now();
  await viewer.load('generated/large.xlsx');
  console.log(`large.xlsx: first sheet shown after ${Date.now() - started} ms`);

  await page.locator('.ov-sheet-tab', { hasText: 'Data' }).click();
  await expect(page.locator('.ng-c', { hasText: 'Revenue' })).toBeVisible({ timeout: 60_000 });
  console.log(`large.xlsx: 100,000-row sheet shown after ${Date.now() - started} ms`);

  await page.locator('.ov-viewport').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.locator('.ng-hr', { hasText: /^100001$/ })).toBeVisible();
  expect(viewer.problems).toEqual([]);
});

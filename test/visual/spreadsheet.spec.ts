import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { lastSent } from './comparison';
import { openViewer } from './harness';
import { answerPick, lastPick } from './picks';

const SCREENS = 'test-results/screens';

/**
 * Center of a cell on screen, located through its row and column headers. The grid redraws its
 * headers as it scrolls, so a header found just before a redraw is measured again.
 */
async function cellCenter(page: Page, column: string, row: number) {
  let center: { x: number; y: number } | undefined;
  await expect(async () => {
    const col = await page
      .locator('.ng-hc', { hasText: new RegExp(`^${column}$`) })
      .first()
      .boundingBox();
    const header = await page
      .locator('.ng-hr', { hasText: new RegExp(`^${row}$`) })
      .first()
      .boundingBox();
    if (!col || !header) throw new Error(`Cell ${column}${row} is not on screen`);
    center = { x: col.x + col.width / 2, y: header.y + header.height / 2 };
  }).toPass({ timeout: 2000 });
  return center!;
}

async function clickCell(page: Page, column: string, row: number, modifiers: 'Shift'[] = []) {
  const { x, y } = await cellCenter(page, column, row);
  if (modifiers.length) await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  if (modifiers.length) await page.keyboard.up('Shift');
}

const status = (page: Page) => page.locator('.ov-status');

/** Screenshots the sheet tab row and the status row under it. */
async function shootBottomBars(page: Page, path: string) {
  const tabs = (await page.locator('.ov-tabbar').boundingBox())!;
  const footer = (await page.locator('.ov-footer').boundingBox())!;
  await page.screenshot({
    path,
    clip: { x: 0, y: tabs.y, width: tabs.width, height: footer.y + footer.height - tabs.y },
  });
}
const activeTab = (page: Page) => page.locator('.ov-sheet-tab[aria-selected="true"]');

/** Text the viewer puts on the clipboard for the current selection. */
const copied = (page: Page) =>
  page.evaluate(() => {
    const data = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data }));
    return data.getData('text/plain');
  });

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as const) {
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
    // Conditional formatting: data bars, and a fill on the negative change.
    await expect(page.locator('.ng-main .ng-bar')).toHaveCount(6);
    const negative = page.locator('.ng-main .ng-c', { hasText: '-4.1%' });
    expect(await negative.evaluate((el) => el.style.background)).not.toBe('');
    await expect(status(page)).toContainText('A1');
    await page.screenshot({ path: `${SCREENS}/xlsx-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`draws pictures, charts and text boxes in the ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.xlsx');
    await page.locator('.ov-sheet-tab', { hasText: 'Charts' }).click();

    // Charts are drawn as Excel shows them, in place of their placeholders.
    const charts = page.locator('.ng-chart-box');
    await expect(charts).toHaveCount(2);
    await expect(charts.first().locator('canvas')).toBeVisible();
    await expect(page.locator('.ng-chart')).toHaveCount(0);
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
  await expect(page.locator('.ng-chart-box').first()).toBeVisible();

  await page.locator('.ov-viewport').evaluate((el) => el.scrollTo(el.scrollWidth, el.scrollHeight));
  await expect(page.locator('.ng-main .ng-pic')).toHaveCount(1);
  await expect(page.locator('.ng-main .ng-pic')).toBeInViewport();
});

test('spills text by alignment and fills styled rows and columns', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  await page.locator('.ov-sheet-tab', { hasText: 'No Grid' }).click();
  await expect(page.locator('.ng-main .ng-c', { hasText: 'Centered across' })).toBeVisible();

  // Measured in one go: the grid may repaint, replacing elements, between separate calls.
  const { cells, columns } = await page.evaluate(() => {
    const rects = (selector: string) =>
      Object.fromEntries(
        [...document.querySelectorAll(selector)].map((el) => {
          const { x, width } = el.getBoundingClientRect();
          return [el.textContent, { x, right: x + width }];
        }),
      );
    return { cells: rects('.ng-main .ng-c'), columns: rects('.ng-top .ng-hc') };
  });
  const { B: b, C: c, D: d, F: f } = columns;

  // Right-aligned text grows to the left; centered text grows evenly around its cell.
  const right = cells['Right-aligned text spills left'];
  expect(right.x).toBeLessThan(f.x);
  expect(right.right).toBeCloseTo(f.right, 0);
  const centered = cells['Centered text spills to both sides'];
  expect(centered.x).toBeLessThan(c.x);
  expect(centered.x).toBeGreaterThanOrEqual(b.x - 1);
  expect(c.x - centered.x).toBeCloseTo(centered.right - c.right, 0);
  const across = cells['Centered across B to D'];
  expect(across.x).toBeCloseTo(b.x, 0);
  expect(across.right).toBeCloseTo(d.right, 0);

  // A styled row and a styled column paint cells the file doesn't list.
  await expect(page.locator('.ng-main .ng-band')).toHaveCount(2);
  await page.screenshot({ path: `${SCREENS}/xlsx-layout.png` });
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

test("shows the selected cell's formula like Excel's formula bar", async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  const formula = page.locator('.ov-status-formula');

  await clickCell(page, 'B', 9);
  await expect(status(page)).toContainText('7,725');
  await expect(formula).toHaveText('fxFormula =SUM(B3:B8)');
  // Filled down, so stored once: each cell shows its own references.
  await clickCell(page, 'D', 5);
  await expect(status(page)).toContainText('-4.1%');
  await expect(formula).toHaveText('fxFormula =C5/B5-1');
  await shootBottomBars(page, `${SCREENS}/spreadsheet-formula-dark.png`);

  // Plain values and ranges show none.
  await clickCell(page, 'B', 5);
  await expect(formula).toHaveCount(0);
  await clickCell(page, 'D', 8, ['Shift']);
  await expect(status(page)).toContainText('Sum:');
  await expect(formula).toHaveCount(0);

  await clickCell(page, 'D', 5);
  await viewer.setTheme('light');
  await expect(formula).toHaveText('fxFormula =C5/B5-1');
  await shootBottomBars(page, `${SCREENS}/spreadsheet-formula-light.png`);
  expect(viewer.problems).toEqual([]);
});

test('follows links in cells with Ctrl+click or from the status bar', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  // Web links go to the extension host, which has VS Code open them (asking first).
  const followed = async () =>
    ((await viewer.sent()) as { type: string; href?: string }[])
      .filter((message) => message.type === 'openLink')
      .map((message) => message.href);
  const link = page.locator('.ov-status-link');

  // Hovering says where a link goes; a plain click only selects the cell.
  const { x, y } = await cellCenter(page, 'E', 12);
  await page.mouse.move(x, y);
  await expect(page.locator('.ov-viewport')).toHaveAttribute(
    'title',
    'https://example.com/budget\nCtrl+click to follow link',
  );
  await page.mouse.click(x, y);
  await expect(link).toHaveText('https://example.com/budget');
  await expect(link).toHaveAttribute('title', 'Follow Link: https://example.com/budget');
  await shootBottomBars(page, `${SCREENS}/spreadsheet-link-dark.png`);
  expect(await followed()).toEqual([]);

  await page.keyboard.down('Control');
  await page.mouse.click(x, y);
  await page.keyboard.up('Control');
  expect(await followed()).toEqual(['https://example.com/budget']);

  // HYPERLINK formulas are links too, followed from the status bar.
  await clickCell(page, 'E', 14);
  await link.click();
  expect(await followed()).toEqual(['https://example.com/budget', 'mailto:team@example.com']);

  // A place in the workbook switches sheets and selects it.
  const inside = await cellCenter(page, 'E', 13);
  await page.keyboard.down('Control');
  await page.mouse.click(inside.x, inside.y);
  await page.keyboard.up('Control');
  await expect(activeTab(page)).toHaveText('Data');
  await expect(status(page).locator('span').first()).toHaveText('B5');

  await page.locator('.ov-sheet-tab', { hasText: 'Budget' }).click();
  await expect(activeTab(page)).toHaveText('Budget');
  await expect(status(page)).toContainText('A1');
  await clickCell(page, 'E', 12);
  await expect(link).toHaveText('https://example.com/budget');
  await viewer.setTheme('light');
  await expect(link).toHaveText('https://example.com/budget');
  await shootBottomBars(page, `${SCREENS}/spreadsheet-link-light.png`);
  expect(viewer.problems).toEqual([]);
});

test('stays on the sheet picked while a linked sheet is still loading', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  const { x, y } = await cellCenter(page, 'E', 13);
  await page.keyboard.down('Control');
  await page.mouse.click(x, y);
  await page.keyboard.up('Control');
  // The Data sheet has 2,000 rows to read; going back before it is shown wins.
  await page.locator('.ov-sheet-tab', { hasText: 'Budget' }).click();
  await expect(activeTab(page)).toHaveText('Budget');
  await page.waitForTimeout(500);
  await expect(activeTab(page)).toHaveText('Budget');
  await expect(status(page).locator('span').first()).toHaveText('A1');
  expect(viewer.problems).toEqual([]);
});

test('copies the selection as a Markdown table', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  const copied = async () => (await lastSent<{ text: string; rows: number }>(viewer, 'copy'))!;

  await clickCell(page, 'A', 2);
  await clickCell(page, 'D', 5, ['Shift']);
  await viewer.post({ type: 'command', command: 'copyAsMarkdown' });
  await expect
    .poll(async () => (await copied())?.text)
    .toBe(
      [
        '| Region | Q2 | Q3 | Change |',
        '| --- | ---: | ---: | ---: |',
        '| North | 1,240 | 1,385 | 11.7% |',
        '| South | 980 | 1,012 | 3.3% |',
        '| East | 1,105 | 1,060 | -4.1% |',
      ].join('\n'),
    );
  expect((await copied()).rows).toBe(4);

  // Right-clicking another cell selects it for the context menu; a single cell copies the
  // block of data around it.
  const { x, y } = await cellCenter(page, 'B', 7);
  await page.mouse.click(x, y, { button: 'right' });
  await expect(status(page).locator('span').first()).toHaveText('B7');
  await viewer.post({ type: 'command', command: 'copyAsMarkdown' });
  await expect.poll(async () => (await copied()).rows).toBe(14);
  expect((await copied()).text.split('\n')[0]).toBe('| Q3 Budget Overview |  |  |  |  |  |');
  expect(viewer.problems).toEqual([]);
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

test('moves between sheet tabs with the keyboard', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');

  await expect(page.getByRole('tablist', { name: 'Sheets' })).toBeVisible();
  const tabs = page.getByRole('tab');
  // Only the selected tab is a tab stop.
  await expect(tabs.first()).toHaveAttribute('tabindex', '0');
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1');

  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(activeTab(page)).toHaveText('Data');
  await expect(page.getByRole('tab', { name: 'Data' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(activeTab(page)).toHaveText('Charts');
  await page.keyboard.press('ArrowRight');
  await expect(activeTab(page)).toHaveText('Charts');
  await page.keyboard.press('Home');
  await expect(activeTab(page)).toHaveText('Budget');
  await expect(page.getByRole('tab', { name: 'Budget' })).toBeFocused();
});

/** How far the sheet tabs are scrolled. */
const tabsScroll = (page: Page) =>
  page.getByRole('tablist').evaluate((list) => Math.round(list.scrollLeft));

for (const theme of ['dark', 'light'] as const) {
  test(`reaches every sheet when the tabs don't fit, in the ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('many-sheets.xlsx');

    // Opened on a sheet in the middle: its tab is in view, with more tabs on both sides.
    await expect(activeTab(page)).toHaveText('Jun 2025');
    await expect(activeTab(page)).toBeInViewport({ ratio: 1 });
    const left = page.getByRole('button', { name: 'Scroll Sheet Tabs Left' });
    const right = page.getByRole('button', { name: 'Scroll Sheet Tabs Right' });
    await expect(left).toBeEnabled();
    await expect(right).toBeEnabled();
    await shootBottomBars(page, `${SCREENS}/xlsx-many-sheets-${theme}.png`);

    // The arrows page through the tabs to either end.
    while (await right.isEnabled()) await right.click();
    // Tab widths are fractional, so the last one can stay a hair short of the edge.
    await expect(page.getByRole('tab', { name: 'Notes' })).toBeInViewport({ ratio: 0.95 });
    while (await left.isEnabled()) await left.click();
    await expect(page.getByRole('tab', { name: 'Summary' })).toBeInViewport({ ratio: 0.95 });
    await expect(left).toBeDisabled();
    expect(viewer.problems).toEqual([]);
  });
}

test('scrolls the sheet tabs with the mouse wheel', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('many-sheets.xlsx');
  const before = await tabsScroll(page);
  await page.getByRole('tab', { name: 'Jun 2025' }).hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => tabsScroll(page)).toBeGreaterThan(before);
  // The page itself doesn't move, and the sheet stays the same.
  await expect(activeTab(page)).toHaveText('Jun 2025');
});

test('lists every sheet to pick from', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('many-sheets.xlsx');

  await page.getByRole('button', { name: 'All Sheets' }).click();
  const request = await lastPick(viewer);
  expect(request.placeholder).toBe('Go to a sheet (35 sheets)');
  expect(request.items).toHaveLength(35);
  const current = request.items.filter((item) => item.current);
  expect(current).toEqual([{ label: 'Jun 2025', description: 'current', current: true }]);

  // VS Code lists them; the one picked comes back and its tab scrolls into view.
  await answerPick(viewer, request, 'Raw data export from the billing system');
  await expect(activeTab(page)).toHaveText('Raw data export from the billing system');
  await expect(activeTab(page)).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.ng-c', { hasText: 'Raw data export' }).first()).toBeVisible();

  // Go to Sheet… in the Command Palette (Ctrl+Shift+O) asks for the same list.
  await viewer.post({ type: 'command', command: 'goTo' });
  await lastPick(viewer, 2);
});

test('gives the sheet tabs and the selected cell a row each', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('many-sheets.xlsx');
  await viewer.post({ type: 'command', command: 'goTo' });
  await answerPick(viewer, await lastPick(viewer), 'Notes');
  await expect(activeTab(page)).toHaveText('Notes');
  await clickCell(page, 'A', 7);

  // The tabs have the whole width of their row; the cell's text has the row under it, cut
  // short with all of it on hover.
  const bar = (await page.locator('.ov-tabbar').boundingBox())!;
  const footer = (await page.locator('.ov-footer').boundingBox())!;
  expect(footer.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect((await page.getByRole('tablist').boundingBox())!.width).toBeGreaterThan(bar.width * 0.8);
  await expect(status(page)).toContainText('A7');
  const value = page.locator('.ov-status-value');
  await expect(value).toHaveAttribute('title', /^Figures before March 2025 .* Q4 2025 review\.$/);
  expect(await value.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await shootBottomBars(page, `${SCREENS}/xlsx-status-long-text.png`);

  // Still both in a narrow view.
  await page.setViewportSize({ width: 520, height: 760 });
  await expect(value).toBeVisible();
  await expect(activeTab(page)).toBeInViewport({ ratio: 0.95 });
});

test('shows no tab scrolling buttons when every tab fits', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'All Sheets' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Scroll Sheet Tabs Right' })).toBeHidden();
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
  await expect(page.locator('.ov-tabbar')).toBeHidden();
});

test('says so when a file is empty', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('empty.xlsx');
  await expect(page.locator('.ov-error-message')).toHaveText('The file is empty.');
  await expect(page.locator('.ov-error .ov-button')).toHaveText('Open in Excel');
  expect(viewer.problems).toEqual([]);
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

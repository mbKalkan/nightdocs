import { expect, test, type Page } from '@playwright/test';
import type { ScrollAnchor } from '../../src/shared/protocol';
import { lastSent, openComparison, relayScroll } from './comparison';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const marked = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((elements) => elements.map((el) => el.textContent?.trim()));

const scrollTop = (page: Page) =>
  page.locator('.ov-viewport').evaluate((viewport) => viewport.scrollTop);

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`compares two versions of a Word document in the ${theme} theme`, async ({ context }) => {
    const [original, modified] = await openComparison(
      [await context.newPage(), await context.newPage()],
      theme,
      ['sample.docx', 'sample-revised.docx'],
    );

    // Removed words and paragraphs on the left, added ones on the right.
    expect(await marked(original.page, 'span.nd-diff-word.nd-diff-removed')).toEqual([
      'leadership team',
      'two',
      '1,060',
      '4.1',
    ]);
    expect(await marked(modified.page, 'span.nd-diff-word.nd-diff-added')).toEqual([
      'board',
      'three',
      '1,095',
      '0.9',
    ]);
    expect(
      await marked(original.page, '.nd-diff-line.nd-diff-removed:not(:has(.nd-diff-word))'),
    ).toEqual(['Self-service answers most common questions.', 'Hire two support engineers.']);
    expect(
      await marked(modified.page, '.nd-diff-line.nd-diff-added:not(:has(.nd-diff-word))'),
    ).toEqual(['Churn fell for the third quarter in a row.', 'Open a support hub in Lisbon.']);
    for (const { page } of [original, modified]) {
      await expect(page.locator('.ov-diff-status')).toHaveText('5 changes');
    }

    // The modified side opens at its first change, like VS Code's diff editor.
    expect(await scrollTop(modified.page)).toBeGreaterThan(0);
    await original.page.screenshot({ path: `${SCREENS}/compare-docx-original-${theme}.png` });
    await modified.page.screenshot({ path: `${SCREENS}/compare-docx-modified-${theme}.png` });
    expect(original.viewer.problems).toEqual([]);
    expect(modified.viewer.problems).toEqual([]);
  });
}

test('moves between changes and scrolls both sides together', async ({ context }) => {
  const [original, modified] = await openComparison(
    [await context.newPage(), await context.newPage()],
    'dark',
    ['sample.docx', 'sample-revised.docx'],
  );

  // Opened at the first change; the button and F7 go on from there, Shift+F7 goes back.
  const status = modified.page.locator('.ov-diff-status');
  await modified.page.getByRole('button', { name: 'Next Change' }).click();
  await expect(status).toHaveText('Change 2 of 5');
  await modified.page.keyboard.press('F7');
  await modified.page.keyboard.press('F7');
  await modified.page.keyboard.press('F7');
  await expect(status).toHaveText('Change 5 of 5');
  await expect(modified.page.getByText('Open a support hub in Lisbon.')).toBeInViewport();
  await modified.page.keyboard.press('Shift+F7');
  await expect(status).toHaveText('Change 4 of 5');
  await modified.page.keyboard.press('F7');
  await expect(status).toHaveText('Change 5 of 5');

  // The other side follows to the same place.
  await expect.poll(() => lastSent(modified.viewer, 'scroll')).toBeTruthy();
  await relayScroll(modified, original);
  await expect(original.page.getByText('Review pricing in the East region.')).toBeInViewport();

  // And back to the top.
  await original.page.locator('.ov-viewport').evaluate((viewport) => (viewport.scrollTop = 0));
  await expect
    .poll(
      async () =>
        (await lastSent<{ anchor: ScrollAnchor }>(original.viewer, 'scroll'))?.anchor.index,
    )
    .toBe(-1);
  await relayScroll(original, modified);
  await expect.poll(() => scrollTop(modified.page)).toBe(0);
});

test('shows no changes between identical files', async ({ context }) => {
  const [original, modified] = await openComparison(
    [await context.newPage(), await context.newPage()],
    'dark',
    ['sample.docx', 'sample.docx'],
  );
  for (const { page } of [original, modified]) {
    await expect(page.locator('.ov-diff-status')).toHaveText('No changes');
    await expect(page.getByRole('button', { name: 'Next Change' })).toBeDisabled();
    await expect(page.locator('.nd-diff-line, .nd-diff-word')).toHaveCount(0);
  }
});

test('stops comparing when the other side closes', async ({ context }) => {
  const [original] = await openComparison(
    [await context.newPage(), await context.newPage()],
    'dark',
    ['sample.docx', 'sample-revised.docx'],
  );
  await original.viewer.post({ type: 'diff', side: undefined });
  await expect(original.page.locator('.ov-diff')).toHaveCount(0);
  await expect(original.page.locator('.nd-diff-line, .nd-diff-word')).toHaveCount(0);
  await expect(original.page.getByText('Prepared for the leadership team.')).toBeVisible();
});

/** Tabs with a change dot, as `name: added|removed`. */
const changedTabs = (page: Page) =>
  page
    .locator('.ov-sheet-tab[data-change]')
    .evaluateAll((tabs) =>
      tabs.map((tab) => `${tab.textContent}: ${(tab as HTMLElement).dataset.change}`),
    );

const selectedTab = (page: Page) => page.locator('.ov-sheet-tab[aria-selected="true"]');

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`compares two versions of an Excel workbook in the ${theme} theme`, async ({ context }) => {
    const [original, modified] = await openComparison(
      [await context.newPage(), await context.newPage()],
      theme,
      ['orders.xlsx', 'orders-revised.xlsx'],
    );

    // The revised list has a quantity changed, an order removed and one added on screen, a
    // price changed far down, a status changed on another sheet, and a new sheet.
    await expect(original.page.locator('.ov-diff-status')).toHaveText('5 changes');
    await expect(modified.page.locator('.ov-diff-status')).toHaveText('6 changes');
    expect(await changedTabs(original.page)).toEqual(['Orders: removed', 'Summary: removed']);
    expect(await changedTabs(modified.page)).toEqual([
      'Orders: added',
      'Summary: added',
      'Notes: added',
    ]);

    // Quantity and total of SO-1005 changed; SO-1012 is only on the left, SO-1099 on the right.
    await expect(original.page.locator('.ng-diff-cell.ng-diff-removed').first()).toBeVisible();
    await expect(modified.page.locator('.ng-diff-cell.ng-diff-added').first()).toBeVisible();
    await expect(original.page.locator('.ng-diff:not(.ng-diff-cell).ng-diff-removed')).toHaveCount(
      1,
    );
    await expect(modified.page.locator('.ng-diff:not(.ng-diff-cell).ng-diff-added')).toHaveCount(1);
    await expect(original.page.locator('.ng-diff-gap.ng-diff-added')).toHaveCount(1);
    await expect(modified.page.locator('.ng-diff-gap.ng-diff-removed')).toHaveCount(1);
    const removedRows = original.page.locator('.ng-hr.ng-diff-removed');
    await expect(removedRows.nth(0)).toHaveText('6');
    await expect(removedRows.nth(1)).toHaveText('13');

    // Like VS Code's diff editor, the modified side opens at the first change.
    expect(await scrollTop(modified.page)).toBeGreaterThan(0);
    await expect.poll(() => lastSent(modified.viewer, 'scroll')).toBeTruthy();
    await relayScroll(modified, original);
    await original.page.screenshot({ path: `${SCREENS}/compare-xlsx-original-${theme}.png` });
    await modified.page.screenshot({ path: `${SCREENS}/compare-xlsx-modified-${theme}.png` });
    expect(original.viewer.problems).toEqual([]);
    expect(modified.viewer.problems).toEqual([]);
  });
}

test('moves between changes across sheets and switches sheets together', async ({ context }) => {
  const [original, modified] = await openComparison(
    [await context.newPage(), await context.newPage()],
    'dark',
    ['orders.xlsx', 'orders-revised.xlsx'],
  );
  const status = modified.page.locator('.ov-diff-status');

  // Opened at the first change; the far-down price change is the fourth.
  await expect.poll(() => scrollTop(modified.page)).toBeGreaterThan(0);
  for (const position of [2, 3, 4]) {
    await modified.page.keyboard.press('F7');
    await expect(status).toHaveText(`Change ${position} of 6`);
  }
  await expect(modified.page.locator('.ng-hr', { hasText: /^54$/ })).toBeInViewport();
  await expect(modified.page.locator('.ng-diff-cell.ng-diff-added')).not.toHaveCount(0);

  // The next changes are on the other sheets.
  await modified.page.keyboard.press('F7');
  await expect(status).toHaveText('Change 5 of 6');
  await expect(selectedTab(modified.page)).toHaveText('Summary');
  // Going on to a sheet that is still loading and straight back lands where it was aimed: both
  // presses arrive before the sheet does.
  await modified.page.evaluate(() => {
    for (const shiftKey of [false, true]) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', shiftKey }));
    }
  });
  await expect(status).toHaveText('Change 5 of 6');
  await expect(selectedTab(modified.page)).toHaveText('Summary');
  await modified.page.keyboard.press('F7');
  await expect(status).toHaveText('Change 6 of 6');
  await expect(selectedTab(modified.page)).toHaveText('Notes');
  await modified.page.keyboard.press('Shift+F7');
  await expect(status).toHaveText('Change 5 of 6');

  // The other side follows to the same sheet, and stays put for a sheet it doesn't have.
  /** Relays the modified side's position once it reports being on `sheet`. */
  const relaySheet = async (sheet: string) => {
    await expect
      .poll(
        async () =>
          (await lastSent<{ anchor: ScrollAnchor }>(modified.viewer, 'scroll'))?.anchor.sheet,
      )
      .toBe(sheet);
    await relayScroll(modified, original);
  };
  await relaySheet('Summary');
  await expect(selectedTab(original.page)).toHaveText('Summary');
  await modified.page.getByRole('tab', { name: 'Notes' }).click();
  await relaySheet('Notes');
  await expect(selectedTab(original.page)).toHaveText('Summary');

  // Back on the first sheet, rows scroll together past the removed order.
  await modified.page.getByRole('tab', { name: 'Orders' }).click();
  await relaySheet('Orders');
  await expect(selectedTab(original.page)).toHaveText('Orders');
  await modified.page.locator('.ov-viewport').evaluate((viewport) => (viewport.scrollTop = 450));
  await expect
    .poll(
      async () =>
        (await lastSent<{ anchor: ScrollAnchor }>(modified.viewer, 'scroll'))?.anchor.index,
    )
    .toBeGreaterThan(20);
  await relayScroll(modified, original);
  /** The first row number below the column headers and the frozen header row. */
  const topRow = (page: Page) =>
    page.evaluate(() => {
      const viewport = document.querySelector('.ov-viewport') as HTMLElement;
      const top = viewport.getBoundingClientRect().top + 41;
      const headers = [...document.querySelectorAll<HTMLElement>('.ng-left .ng-hr')];
      return headers.find((header) => header.getBoundingClientRect().bottom > top)?.textContent;
    });
  // One order was removed above and one added: past both, the same rows line up.
  await expect.poll(() => topRow(original.page)).toBe(await topRow(modified.page));
});

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`compares two versions of a presentation in the ${theme} theme`, async ({ context }) => {
    const [original, modified] = await openComparison(
      [await context.newPage(), await context.newPage()],
      theme,
      ['sample.pptx', 'sample-revised.pptx'],
    );

    // The revision edits a list, a table cell and a chart, adds a slide, replaces a picture
    // and removes a slide; each side has an empty stand-in for the other's extra slide.
    for (const { page } of [original, modified]) {
      await expect(page.locator('.ov-diff-status')).toHaveText('6 changes');
      await expect(page.locator('.pptx-slide.nd-slide-changed')).toHaveCount(4);
      await expect(page.locator('.nd-diff-object')).toHaveCount(2);
    }
    await expect(original.page.locator('.nd-slide-only.nd-diff-removed')).toContainText(
      'Already dark',
    );
    await expect(original.page.locator('.nd-slide-gap.nd-diff-added')).toHaveCount(1);
    await expect(modified.page.locator('.nd-slide-only.nd-diff-added')).toContainText('Next steps');
    await expect(modified.page.locator('.nd-slide-gap.nd-diff-removed')).toHaveCount(1);
    expect(await marked(original.page, 'span.nd-diff-word.nd-diff-removed')).toEqual([
      '40',
      '1,060',
      '4.1',
    ]);
    expect(await marked(modified.page, 'span.nd-diff-word.nd-diff-added')).toEqual([
      '55',
      '•',
      'Self-service portal launched in May',
      '1,095',
      '0.9',
    ]);

    // Like VS Code's diff editor, the modified side opens at the first change.
    expect(await scrollTop(modified.page)).toBeGreaterThan(0);
    await expect.poll(() => lastSent(modified.viewer, 'scroll')).toBeTruthy();
    await relayScroll(modified, original);
    await original.page.screenshot({ path: `${SCREENS}/compare-pptx-original-${theme}.png` });
    await modified.page.screenshot({ path: `${SCREENS}/compare-pptx-modified-${theme}.png` });
    expect(original.viewer.problems).toEqual([]);
    expect(modified.viewer.problems).toEqual([]);
  });
}

test('moves between changed slides and keeps both decks lined up', async ({ context }) => {
  const [original, modified] = await openComparison(
    [await context.newPage(), await context.newPage()],
    'dark',
    ['sample.pptx', 'sample-revised.pptx'],
  );
  const status = modified.page.locator('.ov-diff-status');

  // Opened at the edited list; then the table, the chart and the added slide.
  await expect.poll(() => scrollTop(modified.page)).toBeGreaterThan(0);
  for (const position of [2, 3, 4]) {
    await modified.page.keyboard.press('F7');
    await expect(status).toHaveText(`Change ${position} of 6`);
  }
  await expect(modified.page.locator('.nd-slide-only')).toBeInViewport();

  // The other side shows its stand-in for that slide at the same place.
  await expect
    .poll(
      async () =>
        (await lastSent<{ anchor: ScrollAnchor }>(modified.viewer, 'scroll'))?.anchor.index,
    )
    .toBe(3);
  await relayScroll(modified, original);
  await expect(original.page.locator('.nd-slide-gap')).toBeInViewport();
  const position = await scrollTop(modified.page);
  await expect
    .poll(async () => Math.abs((await scrollTop(original.page)) - position))
    .toBeLessThan(2);

  // The removed slide is the last change; the modified side has a stand-in for it.
  await modified.page.keyboard.press('F7');
  await modified.page.keyboard.press('F7');
  await expect(status).toHaveText('Change 6 of 6');
  await expect(modified.page.locator('.nd-slide-gap')).toBeInViewport();

  // Closing the comparison takes the stand-ins and marks away.
  await original.viewer.post({ type: 'diff', side: undefined });
  await expect(
    original.page.locator('.nd-slide-gap, .nd-diff-word, .nd-slide-changed'),
  ).toHaveCount(0);
  await expect(original.page.locator('.pptx-slide')).toHaveCount(8);
});

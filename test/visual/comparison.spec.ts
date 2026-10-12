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
    .poll(async () => (await lastSent<{ anchor: ScrollAnchor }>(original.viewer, 'scroll'))?.anchor)
    .toEqual({ index: -1, fraction: 0 });
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

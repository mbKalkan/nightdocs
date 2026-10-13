import { expect, test, type Page } from '@playwright/test';
import type { DocumentSummary } from '../../src/shared/protocol';
import { lastSent, openComparison } from './comparison';
import { openViewer } from './harness';
import { answerPick, lastPick } from './picks';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const highlighted = (page: Page) =>
  page.evaluate(() =>
    ['nd-comment', 'nd-comment-active'].filter((name) => CSS.highlights.has(name)),
  );

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`shows comments and tracked changes in the ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('review.docx');

    // Tracked changes are marked in place, commented text is highlighted.
    await expect(page.locator('section.docx del')).toHaveText(['60']);
    await expect(page.locator('section.docx ins')).toHaveText(['45', 'three months of ']);
    await expect(page.locator('.nd-comment')).toHaveCount(2);
    expect(await highlighted(page)).toEqual(['nd-comment']);
    await expect(page.getByRole('button', { name: '2 comments' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Markup' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Hovering a comment's button shows the comment.
    await page.locator('.nd-comment').first().hover();
    const popup = page.locator('.nd-comment-popup');
    await expect(popup).toContainText('Alex Morgan');
    await expect(popup).toContainText('Can we commit to 20 days? Sales asked for it.');
    expect(await highlighted(page)).toEqual(['nd-comment', 'nd-comment-active']);
    await page.screenshot({ path: `${SCREENS}/docx-review-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('hides and shows the markup, and keeps the choice on reload', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('review.docx');
  const markup = page.getByRole('button', { name: 'Markup' });

  await markup.click();
  await expect(markup).toHaveAttribute('aria-pressed', 'false');
  await expect(markup).toHaveAttribute('title', 'Show Comments and Tracked Changes');
  // The text reads as with all changes accepted.
  await expect(page.locator('section.docx del')).toBeHidden();
  await expect(page.locator('.nd-comment').first()).toBeHidden();
  await expect(page.locator('section.docx p', { hasText: 'Payment is due' })).toHaveText(
    'Payment is due within 45 days of the invoice date.',
    { useInnerText: true },
  );
  expect(await highlighted(page)).toEqual([]);

  await viewer.load('review.docx', true);
  await expect(page.getByRole('button', { name: 'Markup' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Markup' }).click();
  await expect(page.locator('section.docx del')).toBeVisible();
});

test('lists the comments and opens the one picked', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('review.docx');
  await page.getByRole('button', { name: 'Markup' }).click();

  await page.getByRole('button', { name: '2 comments' }).click();
  const request = await lastPick(viewer);
  expect(request.placeholder).toBe('Go to a comment (2 comments)');
  expect(request.items.map((item) => item.label)).toEqual([
    'Can we commit to 20 days? Sales asked for it.',
    'Legal wants this reviewed before signing.',
  ]);
  expect(request.items[0].description).toMatch(/^Alex Morgan · /);

  // Going to a comment shows the markup again and keeps the comment open.
  await answerPick(viewer, request, 'Legal wants this reviewed before signing.');
  await expect(page.getByRole('button', { name: 'Markup' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const popup = page.locator('.nd-comment-popup');
  await expect(popup).toContainText('Legal wants this reviewed before signing.');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
});

test('compares the text with all changes accepted, without the markup', async ({ context }) => {
  const [original, modified] = await openComparison(
    [await context.newPage(), await context.newPage()],
    'dark',
    ['review.docx', 'review.docx'],
  );
  const summary = (await lastSent<{ summary: DocumentSummary }>(original.viewer, 'summary'))!
    .summary;
  expect(summary.format === 'docx' && summary.blocks).toEqual([
    'Supply Agreement',
    'The supplier delivers the goods within 30 days of each order.',
    'Payment is due within 45 days of the invoice date.',
    'Either party may end this agreement with three months of written notice.',
    'The liability of each party is limited to the value of the orders of the last twelve months.',
  ]);
  for (const { page } of [original, modified]) {
    await expect(page.locator('.ov-diff-status')).toHaveText('No changes');
    await expect(page.locator('section.docx del')).toBeHidden();
  }
});

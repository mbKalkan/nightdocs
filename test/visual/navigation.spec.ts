import { expect, test, type Page } from '@playwright/test';
import { lastSent } from './comparison';
import { openViewer } from './harness';
import { answerPick, lastPick } from './picks';

test('shows the page in view and goes to a heading of a Word document', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');
  const status = page.locator('.ov-status');
  await expect(status).toHaveText(/^Page 1 of \d+$/);

  // Go to Heading… lists the headings, indented by level, with their pages.
  await viewer.post({ type: 'command', command: 'goTo' });
  const request = await lastPick(viewer);
  expect(request.placeholder).toBe('Go to a heading (4 headings)');
  expect(request.items.map((item) => item.label)).toEqual([
    'Summary',
    ' Key points',
    'Regional results',
    'Next steps',
  ]);
  expect(request.items[3].description).toMatch(/^Page \d+$/);

  await answerPick(viewer, request, 'Next steps');
  const heading = page.locator('section.docx p', { hasText: /^Next steps$/ });
  await expect(heading).toBeInViewport();
  const top =
    (await heading.boundingBox())!.y - (await page.locator('.ov-viewport').boundingBox())!.y;
  expect(top).toBeGreaterThan(0);
  expect(top).toBeLessThan(60);
  const pageNumber = request.items[3].description!.replace('Page ', '');
  await expect(status).toHaveText(new RegExp(`^Page ${pageNumber} of [0-9]+$`));

  // Asked again, the list opens on that heading.
  await viewer.post({ type: 'command', command: 'goTo' });
  const again = await lastPick(viewer, 2);
  expect(again.items.filter((item) => item.current).map((item) => item.label)).toEqual([
    'Next steps',
  ]);
  expect(viewer.problems).toEqual([]);
});

test('steps through the pages of a long Word document', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('long.docx');
  const status = page.locator('.ov-status');
  await expect(status).toHaveText(/^Page 1 of \d+$/);
  await viewer.post({ type: 'command', command: 'goTo' });
  const request = await lastPick(viewer);
  expect(request.items).toHaveLength(12);
  await answerPick(viewer, request, 'Chapter 7');
  const chapter = request.items.find((item) => item.label === 'Chapter 7')!;
  await expect(status).toHaveText(
    new RegExp(`^${chapter.description!.replace(/^current · /, '')} of [0-9]+$`),
  );
});

test('goes to a slide picked by its title', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');
  await viewer.post({ type: 'command', command: 'goTo' });
  const request = await lastPick(viewer);
  expect(request.placeholder).toBe('Go to a slide (8 slides)');
  expect(request.items.map((item) => item.label)).toEqual([
    '1. Quarterly Review',
    '2. Highlights',
    '3. Regional results',
    '4. Revenue by region',
    '5. Shapes and pictures',
    '6. Already dark',
    '7. Picture background',
    '8. Hidden slide',
  ]);
  expect(request.items[0]).toEqual({
    label: '1. Quarterly Review',
    description: 'current',
    current: true,
  });
  expect(request.items[7].description).toBe('Hidden slide');

  await answerPick(viewer, request, '5. Shapes and pictures');
  await expect(page.locator('.ov-status')).toHaveText('Slide 5 of 8');
  expect(viewer.problems).toEqual([]);
});

const pane = (page: Page) => page.getByRole('complementary', { name: 'Navigation Pane' });
// Not by role: collapsed entries leave the accessibility tree, and the indexes would shift.
const items = (page: Page) => page.locator('.ov-nav-item');

test('lists the headings of a Word document in the navigation pane', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');
  const toggle = page.getByRole('button', { name: 'Navigation Pane' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(pane(page)).toBeHidden();

  await toggle.click();
  await expect(pane(page)).toBeVisible();
  await expect(pane(page)).toContainText('Headings');
  await expect(items(page)).toHaveText(['Summary', 'Key points', 'Regional results', 'Next steps']);
  await expect(items(page).nth(1)).toHaveAttribute('aria-level', '2');
  expect(await lastSent<{ open: boolean }>(viewer, 'setNavigationPane')).toMatchObject({
    open: true,
  });

  // Clicking a heading goes there and marks it as where the document is.
  await items(page).nth(3).click();
  await expect(page.locator('section.docx p', { hasText: /^Next steps$/ })).toBeInViewport();
  await expect(items(page).nth(3)).toHaveAttribute('aria-current', 'location');

  // Headings with headings under them collapse, with the mouse or the keyboard.
  await items(page).nth(0).locator('.ov-nav-twisty').click();
  await expect(items(page).nth(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(items(page).nth(1)).toBeHidden();
  await items(page).nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(items(page).nth(1)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(items(page).nth(1)).toBeFocused();
  await expect(items(page).nth(1)).toHaveAttribute('aria-current', 'location');
  await page.screenshot({ path: 'test-results/screens/nav-docx-dark.png' });

  // It stays open for the next document, and the close button closes it.
  await viewer.load('long.docx');
  await expect(items(page)).toHaveCount(12);
  await pane(page).getByRole('button', { name: 'Close' }).click();
  await expect(pane(page)).toBeHidden();
  expect(await lastSent<{ open: boolean }>(viewer, 'setNavigationPane')).toMatchObject({
    open: false,
  });
  expect(viewer.problems).toEqual([]);
});

test('shows the slides as pictures in the navigation pane', async ({ page }) => {
  const viewer = await openViewer(page, 'light');
  await viewer.load('sample.pptx');
  await viewer.post({ type: 'command', command: 'toggleNavigation' });
  await expect(pane(page)).toContainText('Slides');
  await expect(items(page)).toHaveCount(8);
  await expect(items(page).nth(1)).toHaveAccessibleName('Slide 2: Highlights');
  await expect(items(page).nth(7)).toHaveClass(/ov-nav-muted/);
  // The pictures are drawn as they scroll into the pane.
  await expect(page.locator('.ov-nav-thumb .pptx-slide').first()).toBeVisible();
  await expect(items(page).nth(0)).toHaveAttribute('aria-current', 'location');

  await items(page).nth(4).click();
  await expect(page.locator('.ov-status')).toHaveText('Slide 5 of 8');
  await expect(items(page).nth(4)).toHaveAttribute('aria-current', 'location');
  await page.screenshot({ path: 'test-results/screens/nav-pptx-light.png' });
  expect(viewer.problems).toEqual([]);
});

test('lists the sheets of a workbook in the navigation pane', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('many-sheets.xlsx');
  await page.getByRole('button', { name: 'Navigation Pane' }).click();
  await expect(pane(page)).toContainText('Sheets');
  await expect(items(page)).toHaveCount(35);
  await expect(pane(page).locator('[aria-current]')).toHaveText('Jun 2025');

  await pane(page).getByRole('treeitem', { name: 'Notes' }).click();
  await expect(page.locator('.ov-sheet-tab[aria-selected="true"]')).toHaveText('Notes');
  await expect(pane(page).locator('[aria-current]')).toHaveText('Notes');
  // And the other way round: a tab picked below shows in the pane.
  await page.locator('.ov-sheet-tab', { hasText: 'Regions' }).click();
  await expect(pane(page).locator('[aria-current]')).toHaveText('Regions');
});

test('keeps the navigation pane closed beside a comparison', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');
  const toggle = page.getByRole('button', { name: 'Navigation Pane' });
  await toggle.click();
  await expect(pane(page)).toBeVisible();

  // Half a window is too narrow for it, so a comparison opens without it.
  await viewer.post({ type: 'diff', side: 'modified' });
  await expect(pane(page)).toBeHidden();
  await viewer.load('sample.docx', true);
  await expect(pane(page)).toBeHidden();

  // It still opens on request, without changing what single files remember.
  const saved = (await viewer.sent()).filter((m) => m.type === 'setNavigationPane').length;
  await toggle.click();
  await expect(pane(page)).toBeVisible();
  await toggle.click();
  await expect(pane(page)).toBeHidden();
  expect((await viewer.sent()).filter((m) => m.type === 'setNavigationPane')).toHaveLength(saved);

  await viewer.post({ type: 'diff', side: undefined });
  await expect(pane(page)).toBeVisible();
  expect(viewer.problems).toEqual([]);
});

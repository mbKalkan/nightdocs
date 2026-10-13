import { expect, test } from '@playwright/test';
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

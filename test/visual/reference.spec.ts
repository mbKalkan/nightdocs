import { expect, test, type Page } from '@playwright/test';
import { lastSent } from './comparison';
import { openViewer } from './harness';

type Viewer = Awaited<ReturnType<typeof openViewer>>;
interface Reference {
  location: string;
  text?: string;
}

/** The last reference the viewer asked the host to copy, without the message type. */
async function reference(viewer: Viewer): Promise<Reference | undefined> {
  const message = await lastSent<Reference>(viewer, 'reference');
  return message && { location: message.location, text: message.text };
}

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

test('references the page, heading and paragraph under the pointer in a Word document', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.docx');
  const paragraph = page.locator('.docx-wrapper p', { hasText: 'Retention reached' }).first();
  await paragraph.click({ button: 'right' });

  await viewer.post({ type: 'command', command: 'copyReference' });
  await expect.poll(() => reference(viewer)).toEqual({ location: 'page 1, under "Key points"' });

  await viewer.post({ type: 'command', command: 'copyReferenceWithText' });
  await expect
    .poll(() => reference(viewer))
    .toEqual({
      location: 'page 1, under "Key points"',
      text: '> Retention reached an all-time high.',
    });

  // Selected text wins over the paragraph under the pointer.
  await page
    .locator('.docx-wrapper p', { hasText: 'Onboarding time dropped' })
    .first()
    .evaluate((el) => document.getSelection()?.selectAllChildren(el));
  await viewer.post({ type: 'command', command: 'copyReferenceWithText' });
  await expect
    .poll(async () => (await reference(viewer))?.text)
    .toBe('> Onboarding time dropped by two days.');
  expect(viewer.problems).toEqual([]);
});

test('describes the page in view when nothing was right-clicked', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('long.docx');
  await viewer.post({ type: 'command', command: 'copyReference' });
  await expect.poll(async () => (await reference(viewer))?.location).toMatch(/^page 1\b/);
  expect(viewer.problems).toEqual([]);
});

test('references the selected cells in a workbook', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.xlsx');
  // A right-click selects the cell under the pointer, as in Excel.
  const { x, y } = await cellCenter(page, 'B', 3);
  await page.mouse.click(x, y, { button: 'right' });
  await viewer.post({ type: 'command', command: 'copyReferenceWithText' });
  await expect
    .poll(() => reference(viewer))
    .toEqual({ location: 'sheet "Budget", cell B3', text: '> 1,240' });

  const a2 = await cellCenter(page, 'A', 2);
  await page.mouse.click(a2.x, a2.y);
  const c3 = await cellCenter(page, 'C', 3);
  await page.keyboard.down('Shift');
  await page.mouse.click(c3.x, c3.y);
  await page.keyboard.up('Shift');
  await viewer.post({ type: 'command', command: 'copyReference' });
  await expect.poll(() => reference(viewer)).toEqual({ location: 'sheet "Budget", cells A2:C3' });
  await viewer.post({ type: 'command', command: 'copyReferenceWithText' });
  await expect
    .poll(async () => (await reference(viewer))?.text)
    .toBe(
      ['| Region | Q2 | Q3 |', '| --- | ---: | ---: |', '| North | 1,240 | 1,385 |'].join('\n'),
    );
  expect(viewer.problems).toEqual([]);
});

test('references the slide under the pointer in a presentation', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.pptx');
  await page
    .locator('.pptx-slide')
    .nth(1)
    .click({ button: 'right', position: { x: 40, y: 40 } });
  await viewer.post({ type: 'command', command: 'copyReference' });
  await expect.poll(() => reference(viewer)).toEqual({ location: 'slide 2, "Highlights"' });

  await viewer.post({ type: 'command', command: 'copyReferenceWithText' });
  const withText = await expect
    .poll(async () => (await reference(viewer))?.text)
    .toMatch(/^> Highlights\n> /)
    .then(() => reference(viewer));
  expect(withText?.location).toBe('slide 2, "Highlights"');
  expect(viewer.problems).toEqual([]);
});

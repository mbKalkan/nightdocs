import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { openComparison, type Side } from './comparison';
import { openViewer } from './harness';

/** How far each mark on the change map is from where a change starts, in ruler pixels. */
const mapOffsets = (page: Page, changes: string) =>
  page.evaluate((changes) => {
    const viewport = document.querySelector<HTMLElement>('.ov-viewport')!;
    const ruler = document.querySelector<HTMLElement>('.ov-overview')!;
    const scale = ruler.clientHeight / viewport.scrollHeight;
    const top = viewport.getBoundingClientRect().top;
    const at = (y: number) => (y - top + viewport.scrollTop) * scale;
    const starts = [...document.querySelectorAll(changes)].flatMap((el) => {
      const rect = window.screenRect(el);
      // A change after an element starts where the element ends.
      return el.classList.contains('nd-diff-gap-after')
        ? [at(rect.top), at(rect.bottom)]
        : [at(rect.top)];
    });
    return [...document.querySelectorAll<HTMLElement>('.ov-overview-mark')].map((mark) =>
      Math.min(...starts.map((start) => Math.abs(start - parseFloat(mark.style.top)))),
    );
  }, changes);

/** Zooms out and back in, step by step; after each step the marks are on the changes. */
async function zoomsWithTheMap(sides: Side[], changes: string) {
  for (const { page } of sides)
    await expect(page.locator('.ov-overview-mark').first()).toBeAttached();
  for (const button of ['Zoom Out', 'Zoom Out', 'Zoom In', 'Zoom In', 'Zoom In', 'Zoom In']) {
    for (const { page } of sides) {
      // VS Code shows both sides; a tab in the background gets no animation frames to draw in.
      await page.bringToFront();
      const label = page.locator('.ov-zoom-label');
      const before = await label.innerText();
      await page.locator('.ov-toolbar').getByRole('button', { name: button }).click();
      await expect(label).not.toHaveText(before);
      await expect.poll(async () => Math.max(...(await mapOffsets(page, changes)))).toBeLessThan(2);
    }
  }
  for (const { viewer } of sides) expect(viewer.problems).toEqual([]);
}

/** A comparison shown inline, the original's lines between the new ones. */
const inline = (modified: string, original: string) => async (context: BrowserContext) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 820, height: 760 });
  const viewer = await openViewer(page, 'dark');
  await viewer.load(modified, false, 'dark', {
    original: readFileSync(`test/fixtures/${original}`),
    fileName: `${basename(modified)} (Working Tree)`,
  });
  return [{ page, viewer }];
};

/** A comparison of two versions side by side. */
const sideBySide = (files: [string, string]) => async (context: BrowserContext) =>
  openComparison([await context.newPage(), await context.newPage()], 'dark', files);

const LINES = '.nd-diff-line, .nd-diff-gap-before, .nd-diff-gap-after';
const SLIDES = '.nd-slide-changed, .nd-slide-only, .nd-slide-gap';

for (const { name, open, changes } of [
  {
    name: 'Markdown inline',
    open: inline('markdown/sample-revised.md', 'markdown/sample.md'),
    changes: LINES,
  },
  {
    name: 'Markdown side by side',
    open: sideBySide(['markdown/sample.md', 'markdown/sample-revised.md']),
    changes: LINES,
  },
  { name: 'Word inline', open: inline('sample-revised.docx', 'sample.docx'), changes: LINES },
  {
    name: 'Word side by side',
    open: sideBySide(['sample.docx', 'sample-revised.docx']),
    changes: LINES,
  },
  {
    name: 'PowerPoint side by side',
    open: sideBySide(['sample.pptx', 'sample-revised.pptx']),
    changes: SLIDES,
  },
]) {
  test(`keeps the change map on the changes when zoomed: ${name}`, async ({
    context,
    playwright,
    channel,
  }) => {
    // VS Code's desktop app measures CSS zoom its own way (see playwright.config.ts): a zoomed view
    // stretched the map there.
    await zoomsWithTheMap(await open(context), changes);
    // Browsers, where VS Code for the Web runs, measure it to the standard.
    const browser = await playwright.chromium.launch({ channel });
    try {
      await zoomsWithTheMap(await open(await browser.newContext()), changes);
    } finally {
      await browser.close();
    }
  });
}

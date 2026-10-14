import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { openViewer } from './harness';

const FIXTURES = 'test/fixtures';
const OOXML = 'application/vnd.openxmlformats-officedocument';

/**
 * Office saves templates and macro-enabled files with the same parts as their plain siblings;
 * only the content type of the main part differs. The fixtures here are derived from the samples
 * the same way, so the viewer has to open them alike.
 */
const VARIANTS = [
  {
    source: 'sample.docx',
    name: 'sample.dotx',
    from: `${OOXML}.wordprocessingml.document.main+xml`,
    to: `${OOXML}.wordprocessingml.template.main+xml`,
    shows: '.docx-wrapper > section.docx',
    count: 2,
  },
  {
    source: 'sample.docx',
    name: 'sample.docm',
    from: `${OOXML}.wordprocessingml.document.main+xml`,
    to: 'application/vnd.ms-word.document.macroEnabled.main+xml',
    shows: '.docx-wrapper > section.docx',
    count: 2,
  },
  {
    source: 'prices.xlsx',
    name: 'prices.xltx',
    from: `${OOXML}.spreadsheetml.sheet.main+xml`,
    to: `${OOXML}.spreadsheetml.template.main+xml`,
    shows: '.ng-canvas',
    count: 1,
  },
  {
    source: 'sample.pptx',
    name: 'sample.potx',
    from: `${OOXML}.presentationml.presentation.main+xml`,
    to: `${OOXML}.presentationml.template.main+xml`,
    shows: '.pptx-slide',
    count: 8,
  },
];

test.beforeAll(async () => {
  mkdirSync(`${FIXTURES}/generated`, { recursive: true });
  for (const { source, name, from, to } of VARIANTS) {
    const zip = await JSZip.loadAsync(readFileSync(`${FIXTURES}/${source}`));
    const types = await zip.file('[Content_Types].xml')?.async('string');
    expect(types, `${source} declares its main part`).toContain(from);
    zip.file('[Content_Types].xml', types!.replace(from, to));
    writeFileSync(`${FIXTURES}/generated/${name}`, await zip.generateAsync({ type: 'nodebuffer' }));
  }
});

for (const { name, shows, count } of VARIANTS) {
  test(`opens ${name} like its plain sibling`, async ({ page }) => {
    const viewer = await openViewer(page, 'dark');
    await viewer.load(`generated/${name}`);

    await expect(page.locator('.ov-error')).toHaveCount(0);
    await expect(page.locator(shows)).toHaveCount(count);
    await expect(page.locator('.ov-file-name')).toHaveText(name);
    expect(viewer.problems).toEqual([]);
  });
}

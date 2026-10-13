import { appendFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from '@playwright/test';
import { formatForPath } from '../../src/shared/formats';
import { openViewer } from './harness';

// Opens every Office file in a folder and records how each one went, to find files the viewer
// can't show. Not part of the test run: `npm run corpus -- <folder>` runs it and sums it up.
const folder = process.env.CORPUS_DIR;
const report = process.env.CORPUS_REPORT ?? 'test-results/corpus.jsonl';

test.skip(!folder, 'run with npm run corpus -- <folder>');

/** Office files under a folder, in a stable order. */
function filesIn(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return filesIn(path);
      return formatForPath(path) ? [path] : [];
    })
    .sort();
}

/** How long a file may take to show before it counts as stuck. */
const SHOW_TIMEOUT = 30_000;
/** Sheets of a workbook opened after the first, to read more of it. */
const MORE_SHEETS = 10;

for (const path of folder ? filesIn(folder) : []) {
  test(relative(folder!, path), async ({ page }) => {
    test.setTimeout(SHOW_TIMEOUT * 3);
    const viewer = await openViewer(page, 'dark');
    const started = Date.now();
    await viewer.send(path);
    let outcome: 'shown' | 'refused' | 'stuck' = 'stuck';
    let message: string | undefined;
    try {
      await page.waitForSelector('.docx-wrapper, .ng-canvas, .pptx-deck, .ov-error', {
        timeout: SHOW_TIMEOUT,
      });
      await page.waitForSelector('.ov-progress', { state: 'hidden', timeout: SHOW_TIMEOUT });
      const error = page.locator('.ov-error');
      if (await error.isVisible()) {
        outcome = 'refused';
        message = (await error.innerText()).replace(/\s+/g, ' ').trim();
      } else {
        outcome = 'shown';
      }
    } catch {
      // Stays stuck.
    }
    const ms = Date.now() - started;
    if (outcome === 'shown' && formatForPath(path)?.format === 'xlsx') {
      for (let i = 0; i < MORE_SHEETS; i++) {
        await viewer.post({ type: 'command', command: 'nextSheet' });
        await page.waitForTimeout(50);
        await page
          .waitForSelector('.ov-progress', { state: 'hidden', timeout: SHOW_TIMEOUT })
          .catch(() => (outcome = 'stuck'));
      }
    }
    appendFileSync(
      report,
      `${JSON.stringify({
        file: relative(folder!, path),
        bytes: statSync(path).size,
        outcome,
        ms,
        message,
        problems: [...new Set(viewer.problems)].slice(0, 5),
      })}\n`,
    );
  });
}

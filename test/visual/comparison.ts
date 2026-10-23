// Two viewers side by side, the way VS Code shows a comparison, with the test playing the
// extension host's part in between.
import { expect, type Page } from '@playwright/test';
import type { DocumentSummary, ScrollAnchor } from '../../src/shared/protocol';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

type Viewer = Awaited<ReturnType<typeof openViewer>>;

export interface Side {
  page: Page;
  viewer: Viewer;
}

/** The last message of a kind the webview sent to the extension host. */
export async function lastSent<T>(viewer: Viewer, type: string): Promise<T | undefined> {
  const sent = (await viewer.sent()) as unknown as ({ type: string } & T)[];
  return sent.filter((message) => message.type === type).pop();
}

/**
 * Opens two viewers the way VS Code shows a comparison, and plays the extension host's part:
 * tells each its side and hands each the other's summary.
 */
export async function openComparison(
  pages: [Page, Page],
  theme: ThemeName,
  files: [string, string],
  width = 820,
  options?: Parameters<typeof openViewer>[2],
): Promise<[Side, Side]> {
  const sides = await Promise.all(
    pages.map(async (page, i) => {
      await page.setViewportSize({ width, height: 760 });
      const viewer = await openViewer(page, theme, options);
      await viewer.load(files[i]);
      await viewer.post({ type: 'diff', side: i === 0 ? 'original' : 'modified' });
      return { page, viewer };
    }),
  );
  const summaries = await Promise.all(
    sides.map(async ({ viewer }) => {
      await expect.poll(() => lastSent(viewer, 'summary')).toBeTruthy();
      return (await lastSent<{ summary: DocumentSummary }>(viewer, 'summary'))!.summary;
    }),
  );
  await sides[0].viewer.post({ type: 'peerSummary', summary: summaries[1] });
  await sides[1].viewer.post({ type: 'peerSummary', summary: summaries[0] });
  await Promise.all(sides.map(({ page }) => expect(page.locator('.ov-diff')).toBeVisible()));
  return sides as [Side, Side];
}

/** Hands the scroll position one side last reported to the other side. */
export async function relayScroll(from: Side, to: Side): Promise<void> {
  const message = await lastSent<{ anchor: ScrollAnchor }>(from.viewer, 'scroll');
  if (message) await to.viewer.post({ type: 'peerScroll', anchor: message.anchor });
}

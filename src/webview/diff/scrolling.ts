// Scroll positions in terms of document items, so two versions can scroll together.

import type { ScrollAnchor } from '../../shared/protocol';

/** `ScrollAnchor.index` values both sides take as they are, whatever the content. */
export const TOP = -1;
export const BOTTOM = -2;

/** Canvas left visible above a change brought into view. */
const REVEAL_MARGIN = 48;

/** Converts a screen position to the viewport's scroll coordinates. */
export function scrollTopOf(viewport: HTMLElement, clientY: number): number {
  return clientY - viewport.getBoundingClientRect().top + viewport.scrollTop;
}

/**
 * Where the top of the window is, as a fraction of the first item that reaches it (negative
 * when that item starts lower down), with the item's index translated by `toPeer`.
 */
export function scrollAnchor(
  viewport: HTMLElement,
  items: readonly Element[],
  toPeer: readonly number[],
): ScrollAnchor | undefined {
  if (items.length === 0) return undefined;
  const top = viewport.getBoundingClientRect().top;
  // Items are in document order, so their bottoms only go down.
  let low = 0;
  let high = items.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (items[middle].getBoundingClientRect().bottom <= top) low = middle + 1;
    else high = middle;
  }
  const rect = items[low].getBoundingClientRect();
  const fraction = rect.height > 0 ? (top - rect.top) / rect.height : 0;
  return { index: toPeer[low], fraction };
}

export function scrollToAnchor(
  viewport: HTMLElement,
  items: readonly Element[],
  anchor: ScrollAnchor,
): void {
  if (anchor.index === TOP || anchor.index === BOTTOM) {
    viewport.scrollTop = anchor.index === TOP ? 0 : viewport.scrollHeight;
    return;
  }
  const item = items[Math.min(anchor.index, items.length - 1)];
  if (!item) return;
  const rect = item.getBoundingClientRect();
  viewport.scrollTop = scrollTopOf(viewport, rect.top + anchor.fraction * rect.height);
}

/** Scrolls so that what is at `top` (scroll coordinates) shows near the top of the window. */
export function revealTop(viewport: HTMLElement, top: number): void {
  viewport.scrollTop = Math.max(0, top - REVEAL_MARGIN);
}

/**
 * Scrolls to the next (1) or previous (-1) of the changes at `tops` (scroll positions, top to
 * bottom) from where the view is, wrapping around, and returns which one.
 */
export function revealByTops(
  viewport: HTMLElement,
  tops: readonly number[],
  direction: 1 | -1,
): number | undefined {
  if (tops.length === 0) return undefined;
  const at = viewport.scrollTop + REVEAL_MARGIN;
  let index =
    direction > 0
      ? tops.findIndex((top) => top > at + 1)
      : tops.length - 1 - [...tops].reverse().findIndex((top) => top < at - 1);
  if (index < 0 || index >= tops.length) index = direction > 0 ? 0 : tops.length - 1;
  revealTop(viewport, tops[index]);
  return index;
}

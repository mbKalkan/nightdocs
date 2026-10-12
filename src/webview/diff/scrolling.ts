// Scroll positions in terms of document items, so two versions can scroll together.

import type { ScrollAnchor } from '../../shared/protocol';

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
  const item = items[Math.min(anchor.index, items.length - 1)];
  if (!item) return;
  const rect = item.getBoundingClientRect();
  viewport.scrollTop = scrollTopOf(viewport, rect.top + anchor.fraction * rect.height);
}

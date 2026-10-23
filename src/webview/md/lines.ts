// Elements of a rendered Markdown file and the source lines they came from.

import { scrollTopOf } from '../diff/scrolling';

/** Source lines (0-based), end exclusive. */
export interface LineRange {
  start: number;
  end: number;
}

/** The innermost element at or around `node` that knows its source lines. */
export function lineElement(node: Node | null, root: Element): HTMLElement | undefined {
  const element = node instanceof Element ? node : node?.parentElement;
  const found = element?.closest<HTMLElement>('[data-line]');
  return found && root.contains(found) ? found : undefined;
}

export function linesOf(element: HTMLElement): LineRange {
  const start = Number(element.dataset.line);
  const end = Number(element.dataset.lineEnd);
  return { start, end: Number.isFinite(end) && end > start ? end : start + 1 };
}

/** The lines the selection inside `root` spans, or undefined without one. */
export function selectionLines(root: Element): LineRange | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return undefined;
  const first = lineElement(range.startContainer, root);
  const last = lineElement(range.endContainer, root);
  if (!first || !last) return undefined;
  return { start: linesOf(first).start, end: Math.max(linesOf(first).end, linesOf(last).end) };
}

/**
 * The elements with source lines that hold no others, in document order: what the view can be
 * placed by. Hidden ones (the YAML behind the list of properties) are left out.
 */
export function lineLeaves(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-line]')].filter(
    (element) => !element.querySelector('[data-line]') && element.getClientRects().length > 0,
  );
}

/** The source line (with a fraction) at the top of the view. */
export function lineAtTop(
  viewport: HTMLElement,
  leaves: readonly HTMLElement[],
): number | undefined {
  const top = viewport.getBoundingClientRect().top;
  const leaf = leaves.find((element) => element.getBoundingClientRect().bottom > top);
  if (!leaf) return leaves.length ? linesOf(leaves[leaves.length - 1]).start : undefined;
  const rect = leaf.getBoundingClientRect();
  const { start, end } = linesOf(leaf);
  const fraction = rect.height > 0 ? Math.max(0, (top - rect.top) / rect.height) : 0;
  return start + fraction * (end - start);
}

/**
 * Scrolls so that source line `line` (with a fraction) is at the top of the view, as the text
 * editor beside shows it: inside the element it belongs to, or between the elements around it.
 */
export function revealLine(
  viewport: HTMLElement,
  leaves: readonly HTMLElement[],
  line: number,
): void {
  let index = -1;
  for (let i = 0; i < leaves.length; i++) {
    if (linesOf(leaves[i]).start <= line) index = i;
    else break;
  }
  if (index < 0) {
    viewport.scrollTop = 0;
    return;
  }
  const leaf = leaves[index];
  const { start, end } = linesOf(leaf);
  const rect = leaf.getBoundingClientRect();
  let y: number;
  if (line < end) {
    y = rect.top + ((line - start) / (end - start)) * rect.height;
  } else {
    const next = leaves[index + 1];
    if (!next) {
      y = rect.bottom;
    } else {
      const gapStart = rect.bottom;
      const gapEnd = next.getBoundingClientRect().top;
      const span = linesOf(next).start - end;
      y = gapStart + (span > 0 ? ((line - end) / span) * (gapEnd - gapStart) : 0);
    }
  }
  viewport.scrollTop = scrollTopOf(viewport, y);
}

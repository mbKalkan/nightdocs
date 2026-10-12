// Marking differences in rendered document content.

import type { DiffSide } from '../../shared/protocol';

/** Stands in for a picture in the text of a paragraph, so added or removed pictures count. */
export const OBJECT = '￼';

export const MARK = 'nd-diff-word';

/** What a side marks: the original shows what was removed, the modified what was added. */
export const ownChange = (side: DiffSide) => (side === 'original' ? 'removed' : 'added');
export const otherChange = (side: DiffSide) => (side === 'original' ? 'added' : 'removed');

interface Segment {
  node: Text | Element;
  start: number;
  length: number;
}

/** The text and pictures of an element in reading order, with where each starts. */
function segments(root: Element): Segment[] {
  const result: Segment[] = [];
  let offset = 0;
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child instanceof Text) {
        result.push({ node: child, start: offset, length: child.data.length });
        offset += child.data.length;
      } else if (child instanceof HTMLImageElement || child instanceof SVGSVGElement) {
        result.push({ node: child, start: offset, length: 1 });
        offset += 1;
      } else if (child instanceof Element) {
        walk(child);
      }
    }
  };
  walk(root);
  return result;
}

/** The text of an element, with each picture as one `OBJECT` character. */
export function textOf(root: Element): string {
  return segments(root)
    .map((segment) => (segment.node instanceof Text ? segment.node.data : OBJECT))
    .join('');
}

/**
 * Wraps the characters in `ranges` (`[start, end)` offsets into `textOf(root)`) in spans with
 * `className`; pictures in range get the class themselves.
 */
export function markRanges(root: Element, ranges: [number, number][], className: string): void {
  if (ranges.length === 0) return;
  for (const segment of segments(root)) {
    const end = segment.start + segment.length;
    const inside = ranges
      .map(([from, to]): [number, number] => [
        Math.max(from, segment.start) - segment.start,
        Math.min(to, end) - segment.start,
      ])
      .filter(([from, to]) => from < to);
    if (inside.length === 0) continue;
    if (!(segment.node instanceof Text)) {
      segment.node.classList.add(MARK, className);
      continue;
    }
    const text = segment.node.data;
    const pieces: Node[] = [];
    let at = 0;
    for (const [from, to] of inside) {
      if (from > at) pieces.push(document.createTextNode(text.slice(at, from)));
      const mark = document.createElement('span');
      mark.className = `${MARK} ${className}`;
      mark.textContent = text.slice(from, to);
      pieces.push(mark);
      at = to;
    }
    if (at < text.length) pieces.push(document.createTextNode(text.slice(at)));
    segment.node.replaceWith(...pieces);
  }
}

/** Removes every mark made in `root`, leaving the content as it was rendered. */
export function clearMarks(root: Element, classes: readonly string[]): void {
  for (const mark of root.querySelectorAll(`span.${MARK}`)) {
    const parent = mark.parentNode;
    mark.replaceWith(...mark.childNodes);
    parent?.normalize();
  }
  for (const element of root.querySelectorAll(classes.map((c) => `.${c}`).join(','))) {
    element.classList.remove(MARK, ...classes);
  }
}

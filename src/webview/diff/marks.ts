// Marking differences in rendered document content.

import { diff, sameToken, tokenize } from '../../shared/diff';
import type { DiffSide } from '../../shared/protocol';

/** Stands in for a picture in the text of a paragraph, so added or removed pictures count. */
export const OBJECT = '￼';

export const MARK = 'nd-diff-word';

/** What a side marks: the original shows what was removed, the modified what was added. */
export const ownChange = (side: DiffSide) => (side === 'original' ? 'removed' : 'added');
export const otherChange = (side: DiffSide) => (side === 'original' ? 'added' : 'removed');

interface Segment {
  /** A text node, a picture, or `null` for a break between blocks. */
  node: Text | Element | null;
  start: number;
  length: number;
}

/**
 * Marks an element that isn't part of the document's text, such as a deleted tracked change or
 * a comment's popup; comparisons leave it out.
 */
export const NOT_TEXT = 'data-nd-not-text';

/** Elements that start a new block of text, so their words don't run into the ones before. */
const BLOCKS = new Set([
  'DIV',
  'P',
  'LI',
  'TR',
  'TD',
  'TH',
  'BR',
  'TABLE',
  'SECTION',
  'DL',
  'DT',
  'DD',
  'UL',
  'OL',
  'PRE',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'DETAILS',
  'SUMMARY',
  'FIGURE',
  'FIGCAPTION',
]);

/** The text and pictures of an element in reading order, with where each starts. */
function segments(root: Element): Segment[] {
  const result: Segment[] = [];
  let offset = 0;
  const push = (node: Segment['node'], length: number) => {
    result.push({ node, start: offset, length });
    offset += length;
  };
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child instanceof Element && child.hasAttribute(NOT_TEXT)) continue;
      if (child instanceof Text) {
        push(child, child.data.length);
      } else if (child instanceof HTMLImageElement || child instanceof SVGSVGElement) {
        push(child, 1);
      } else if (child instanceof Element) {
        const last = result[result.length - 1];
        if (BLOCKS.has(child.tagName) && last && last.node !== null) push(null, 1);
        walk(child);
      }
    }
  };
  walk(root);
  return result;
}

/** The text of an element, with each picture as one `OBJECT` character, blocks on new lines. */
export function textOf(root: Element): string {
  return segments(root)
    .map(({ node }) => (node === null ? '\n' : node instanceof Text ? node.data : OBJECT))
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
    if (inside.length === 0 || segment.node === null) continue;
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

/**
 * Marks the words of `element` that aren't in `other`, its counterpart on the other side. A block
 * shown in several elements (a paragraph split by a page break) is compared as their joined text.
 */
export function markWords(
  element: Element | readonly Element[],
  other: string,
  className: string,
): void {
  const parts = element instanceof Element ? [element] : element;
  const texts = parts.map(textOf);
  const mine = tokenize(texts.join(''));
  const theirs = tokenize(other);
  const ranges: [number, number][] = [];
  const blank = (index: number) => /^\s+$/.test(mine[index].text);
  for (const range of diff(mine, theirs, sameToken)) {
    if (range.kind !== 'delete') continue;
    let from = range.aStart;
    let to = range.aEnd;
    while (from < to && blank(from)) from++;
    while (to > from && blank(to - 1)) to--;
    if (from < to) {
      const last = mine[to - 1];
      ranges.push([mine[from].start, last.start + last.text.length]);
    }
  }
  let offset = 0;
  parts.forEach((part, i) => {
    const at = offset;
    markRanges(
      part,
      ranges.map(([from, to]) => [from - at, to - at]),
      className,
    );
    offset += texts[i].length;
  });
}

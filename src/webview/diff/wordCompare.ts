import type { DiffSide, WordSummary } from '../../shared/protocol';
import type { Comparison, RenderContext } from '../renderers/types';
import { align } from './align';
import { clearMarks, markWords, NOT_TEXT, otherChange, ownChange, textOf } from './marks';
import { revealByTops, scrollAnchor, scrollToAnchor, scrollTopOf } from './scrolling';

export interface WordBlocks {
  /** The element holding the whole document, for clearing marks. */
  root: HTMLElement;
  elements: HTMLElement[];
  texts: string[];
}

const LINE = 'nd-diff-line';
const GAP_BEFORE = 'nd-diff-gap-before';
const GAP_AFTER = 'nd-diff-gap-after';
const CLASSES = [
  LINE,
  GAP_BEFORE,
  GAP_AFTER,
  'nd-diff-removed',
  'nd-diff-added',
  'nd-diff-gap-removed',
  'nd-diff-gap-added',
];

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The paragraphs of the document body (not headers, footers or notes) that have text or
 * pictures; these are what two versions are compared by.
 */
export function wordBlocks(root: HTMLElement): WordBlocks {
  const elements: HTMLElement[] = [];
  const texts: string[] = [];
  for (const paragraph of root.querySelectorAll<HTMLElement>('section.docx > article p')) {
    // Such as the paragraphs of a comment.
    if (paragraph.closest(`[${NOT_TEXT}]`)) continue;
    const text = normalize(textOf(paragraph));
    if (text) {
      elements.push(paragraph);
      texts.push(text);
    }
  }
  return { root, elements, texts };
}

/**
 * Marks paragraphs that only this side has, the words that changed in edited paragraphs, and
 * where the other side has paragraphs this one doesn't.
 */
export function compareWord(
  blocks: WordBlocks,
  peer: WordSummary,
  side: DiffSide,
  context: RenderContext,
): Comparison {
  const { root, elements, texts } = blocks;
  const original = side === 'original';
  const alignment = original ? align(texts, peer.blocks) : align(peer.blocks, texts);
  const toPeer = original ? alignment.aToB : alignment.bToA;
  const own = `nd-diff-${ownChange(side)}`;
  const gap = `nd-diff-gap-${otherChange(side)}`;
  const changes: { element: HTMLElement; after: boolean }[] = [];

  for (const hunk of alignment.hunks) {
    const [start, end] = original ? [hunk.aStart, hunk.aEnd] : [hunk.bStart, hunk.bEnd];
    const edited = new Map(hunk.pairs.map(([a, b]) => (original ? [a, b] : [b, a])));
    for (let i = start; i < end; i++) {
      elements[i].classList.add(LINE, own);
      const counterpart = edited.get(i);
      if (counterpart !== undefined) markWords(elements[i], peer.blocks[counterpart], own);
    }
    if (start < end) {
      changes.push({ element: elements[start], after: false });
    } else if (start < elements.length) {
      elements[start].classList.add(GAP_BEFORE, gap);
      changes.push({ element: elements[start], after: false });
    } else if (elements.length > 0) {
      const last = elements[elements.length - 1];
      last.classList.add(GAP_AFTER, gap);
      changes.push({ element: last, after: true });
    }
  }

  const tops = () =>
    changes.map(({ element, after }) => {
      const rect = element.getBoundingClientRect();
      return scrollTopOf(context.viewport, after ? rect.bottom : rect.top);
    });
  return {
    count: changes.length,
    go: (direction) => revealByTops(context.viewport, tops(), direction),
    anchor: () => scrollAnchor(context.viewport, elements, toPeer),
    scrollTo: (anchor) => scrollToAnchor(context.viewport, elements, anchor),
    dispose: () => clearMarks(root, CLASSES),
  };
}

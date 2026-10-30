import { similarity } from '../../shared/diff';
import type { DiffSide } from '../../shared/protocol';
import type { Comparison, RenderContext } from '../renderers/types';
import { align } from './align';
import { clearMarks, markWords, MARK, otherChange, ownChange } from './marks';
import type { OverviewMark } from './overview';
import { revealByTops, revealTop, scrollAnchor, scrollToAnchor, scrollTopOf } from './scrolling';

/** A document as a list of blocks of text (paragraphs, list items, rows), in reading order. */
export interface Blocks {
  /** The element holding the whole document, for clearing marks. */
  root: HTMLElement;
  /** Where each block starts. */
  elements: HTMLElement[];
  /**
   * Every element of each block, for blocks shown in more than one (a paragraph a page break
   * splits); otherwise just its `elements` entry.
   */
  parts?: HTMLElement[][];
  texts: string[];
  /** For each block, what identifies its pictures, so replacing one counts as a change. */
  pictures?: string[];
}

/** The other side's blocks, as its summary carries them. */
export interface PeerBlocks {
  blocks: string[];
  pictures?: string[];
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

interface Change {
  /** Where on this side: its first block, or where the other side's blocks would be. */
  element: HTMLElement;
  /** The last block on this side, when it has any. */
  last?: HTMLElement;
  /** The change is past the last block. */
  after: boolean;
  /** Whether the original version had blocks here, and whether the modified one has. */
  removed: boolean;
  added: boolean;
}

/** Blocks are equal when their text and their pictures are; how alike is up to the text. */
export const blockKeys = (texts: readonly string[], pictures?: readonly string[]) =>
  texts.map((text, i) => (pictures?.[i] ? `${text}\u0000${pictures[i]}` : text));

/** Marks the pictures of an edited block whose pictures changed. */
export function markPictures(element: Element, className: string): void {
  for (const picture of element.querySelectorAll('img, svg, [role="img"]')) {
    picture.classList.add(MARK, className);
  }
}

/**
 * Marks blocks that only this side has, the words that changed in edited blocks, and where the
 * other side has blocks this one doesn't.
 */
export function compareBlocks(
  blocks: Blocks,
  peer: PeerBlocks,
  side: DiffSide,
  context: RenderContext,
): Comparison {
  const { root, elements, texts } = blocks;
  const partsOf = (index: number) => blocks.parts?.[index] ?? [elements[index]];
  const original = side === 'original';
  const own = blockKeys(texts, blocks.pictures);
  const theirs = blockKeys(peer.blocks, peer.pictures);
  const [aTexts, bTexts] = original ? [texts, peer.blocks] : [peer.blocks, texts];
  const alignment = original
    ? align(own, theirs, { score: (x, y) => similarity(aTexts[x], bTexts[y]) })
    : align(theirs, own, { score: (x, y) => similarity(aTexts[x], bTexts[y]) });
  const toPeer = original ? alignment.aToB : alignment.bToA;
  const ownClass = `nd-diff-${ownChange(side)}`;
  const gap = `nd-diff-gap-${otherChange(side)}`;
  const changes: Change[] = [];

  for (const hunk of alignment.hunks) {
    const [start, end] = original ? [hunk.aStart, hunk.aEnd] : [hunk.bStart, hunk.bEnd];
    const peerHas = original ? hunk.bEnd > hunk.bStart : hunk.aEnd > hunk.aStart;
    const lanes = original
      ? { removed: start < end, added: peerHas }
      : { removed: peerHas, added: start < end };
    const edited = new Map(hunk.pairs.map(([a, b]) => (original ? [a, b] : [b, a])));
    for (let i = start; i < end; i++) {
      const parts = partsOf(i);
      for (const part of parts) part.classList.add(LINE, ownClass);
      const counterpart = edited.get(i);
      if (counterpart === undefined) continue;
      markWords(parts, peer.blocks[counterpart], ownClass);
      if ((blocks.pictures?.[i] ?? '') !== (peer.pictures?.[counterpart] ?? '')) {
        for (const part of parts) markPictures(part, ownClass);
      }
    }
    if (start < end) {
      const last = partsOf(end - 1).at(-1)!;
      changes.push({ element: elements[start], last, after: false, ...lanes });
    } else if (start < elements.length) {
      elements[start].classList.add(GAP_BEFORE, gap);
      changes.push({ element: elements[start], after: false, ...lanes });
    } else if (elements.length > 0) {
      const last = partsOf(elements.length - 1).at(-1)!;
      last.classList.add(GAP_AFTER, gap);
      changes.push({ element: last, after: true, ...lanes });
    }
  }

  const { viewport } = context;
  const top = ({ element, after }: Change) => {
    const rect = element.getBoundingClientRect();
    return scrollTopOf(viewport, after ? rect.bottom : rect.top);
  };
  return {
    count: changes.length,
    go: (direction) => revealByTops(viewport, changes.map(top), direction),
    goTo: (index) => revealTop(viewport, top(changes[index])),
    anchor: () => scrollAnchor(viewport, elements, toPeer),
    scrollTo: (anchor) => scrollToAnchor(viewport, elements, anchor),
    overview: () =>
      changes.map((change): OverviewMark => {
        const from = top(change);
        const to = change.last
          ? scrollTopOf(viewport, change.last.getBoundingClientRect().bottom)
          : from;
        return { top: from, bottom: to, removed: change.removed, added: change.added };
      }),
    dispose: () => clearMarks(root, CLASSES),
  };
}

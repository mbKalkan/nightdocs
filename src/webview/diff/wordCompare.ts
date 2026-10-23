import type { DiffSide, WordSummary } from '../../shared/protocol';
import type { Comparison, RenderContext } from '../renderers/types';
import { compareBlocks, type Blocks } from './blockCompare';
import { NOT_TEXT, textOf } from './marks';

export type WordBlocks = Blocks;

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
  return compareBlocks(blocks, peer, side, context);
}

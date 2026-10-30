import type { DiffSide, WordSummary } from '../../shared/protocol';
import { CONTINUED } from '../docx/pageBreaks';
import type { Comparison, RenderContext } from '../renderers/types';
import { compareBlocks, type Blocks } from './blockCompare';
import { NOT_TEXT, textOf } from './marks';

export type WordBlocks = Blocks;

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The paragraphs of the document body (not headers, footers or notes) that have text or
 * pictures; these are what two versions are compared by. A paragraph a page break splits is one
 * block: each save of a document can break its pages in other places.
 */
export function wordBlocks(root: HTMLElement): WordBlocks {
  const elements: HTMLElement[] = [];
  const parts: HTMLElement[][] = [];
  const raw: string[] = [];
  let previous: HTMLElement | undefined;
  for (const paragraph of root.querySelectorAll<HTMLElement>('section.docx > article p')) {
    // Such as the paragraphs of a comment.
    if (paragraph.closest(`[${NOT_TEXT}]`)) continue;
    const text = textOf(paragraph);
    const last = parts.length - 1;
    if (paragraph.classList.contains(CONTINUED) && last >= 0 && parts[last].at(-1) === previous) {
      parts[last].push(paragraph);
      raw[last] += text;
    } else if (normalize(text)) {
      elements.push(paragraph);
      parts.push([paragraph]);
      raw.push(text);
    }
    previous = paragraph;
  }
  return { root, elements, parts, texts: raw.map(normalize) };
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

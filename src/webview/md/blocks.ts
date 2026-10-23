import type { Blocks } from '../diff/blockCompare';
import { textOf } from '../diff/marks';

/**
 * What two versions of a Markdown file are compared by: front matter properties, headings,
 * paragraphs (list items' too), table rows, lines of code, rules, raw HTML blocks and prompt
 * tags. A block inside another (a paragraph in raw HTML) belongs to the outer one.
 */
const BLOCK = [
  '.md-props-list:not(.md-props-nested) > .md-prop',
  '.md-body h1',
  '.md-body h2',
  '.md-body h3',
  '.md-body h4',
  '.md-body h5',
  '.md-body h6',
  '.md-body p',
  '.md-body .md-line',
  '.md-body tr',
  '.md-body hr',
  '.md-body summary',
  '.md-body .md-html',
  '.md-body .md-xml-tag',
].join(', ');

/** A rule has no text; this stands for it, so that adding or removing one shows. */
const RULE = '———';

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

export function markdownBlocks(page: HTMLElement): Blocks {
  const elements: HTMLElement[] = [];
  const texts: string[] = [];
  const pictures: string[] = [];
  for (const element of page.querySelectorAll<HTMLElement>(BLOCK)) {
    if (element.parentElement?.closest(BLOCK)) continue;
    const text = element.tagName === 'HR' ? RULE : normalize(textOf(element));
    if (!text) continue;
    elements.push(element);
    texts.push(text);
    pictures.push(
      [...element.querySelectorAll<HTMLElement>('[data-href], [data-src]')]
        .map((picture) => picture.dataset.href ?? picture.dataset.src)
        .join(' '),
    );
  }
  return { root: page, elements, texts, pictures };
}

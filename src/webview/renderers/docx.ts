import { renderAsync } from 'docx-preview';
import { adaptDocumentColors } from '../darkColors';
import { compareWord, wordBlocks, type WordBlocks } from '../diff/wordCompare';
import { findHeadings, headingClasses, type Heading } from '../docx/outline';
import { WordReview } from '../docx/review';
import { PageNavigator } from '../pageNavigator';
import { paginate } from '../paginate';
import { describe } from '../picker';
import { goToHeading, headingsPane } from '../headings';
import { quote } from '../../shared/reference';
import { blockOf, blockOpening, blockText, selectedTextIn } from '../reference';
import type { RenderContext, RenderedDocument, RenderOptions, Renderer } from './types';

/** Horizontal space around pages; matches the padding of `.docx-wrapper` in viewer.css. */
const PAGE_GUTTER = 2 * 32;

export const docxRenderer: Renderer = {
  async render(
    data: Uint8Array,
    target: HTMLElement,
    options: RenderOptions,
  ): Promise<RenderedDocument> {
    const parsed: unknown = await renderAsync(data, target, undefined, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      // Word records where it broke pages on its last save; reuse that for real pagination.
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      // Shown as Word's "All Markup" does; see WordReview.
      renderComments: true,
      renderChanges: true,
      // Embedded HTML chunks would need frames, which the webview's CSP blocks.
      renderAltChunks: false,
      useBase64URL: false,
      experimental: true,
    });

    const wrapper = target.querySelector<HTMLElement>('.docx-wrapper');
    const previous = options.previous as { markup?: boolean } | undefined;
    const review = new WordReview(
      wrapper ?? target,
      options.strings,
      options.locale,
      previous?.markup ?? true,
    );

    // Page breaks depend on text metrics, so wait for the document's fonts first.
    await document.fonts.ready;
    if (wrapper) paginate(wrapper);

    if (options.palette) {
      adaptDocumentColors(target, options.palette);
    }

    const pages = [...target.querySelectorAll<HTMLElement>('.docx-wrapper > section.docx')];
    const widest = Math.max(0, ...pages.map((page) => page.offsetWidth));
    // Only needed when comparing. Looked up in the wrapper, which stays with the content when
    // it moves out of `target` to be shown.
    let blocks: WordBlocks | undefined;
    const paragraphs = () => (blocks ??= wordBlocks(wrapper ?? target));
    let headings: Heading[] | undefined;
    const outline = () => (headings ??= findHeadings(pages, headingClasses(parsed)));
    let navigator: PageNavigator | undefined;
    let view: RenderContext | undefined;
    return {
      naturalWidth: widest + PAGE_GUTTER,
      activate(context) {
        view = context;
        navigator = new PageNavigator(context, pages, options.strings.pagePosition);
        review.activate(context);
      },
      state: () => ({ markup: review.shown }),
      command(command) {
        if (command === 'goTo' && view) {
          void goToHeading(view, outline(), options.strings, (heading, current) =>
            describe(
              current && options.strings.current,
              options.strings.page.replace('{0}', String(heading.page + 1)),
            ),
          );
        }
      },
      reference(hit, withText) {
        const page = hit?.element.closest<HTMLElement>('.docx-wrapper > section.docx');
        const index = page ? pages.indexOf(page) : (navigator?.current ?? 0);
        if (index < 0 || index >= pages.length) return undefined;
        const element = page ? hit?.element : undefined;
        const heading = headingBefore(outline(), element, index);
        const text = withText
          ? selectedTextIn(wrapper ?? target) || (element ? blockText(element) : '')
          : '';
        // Documents without headings would otherwise be placed by their page alone; how the
        // paragraph begins is something an assistant can search the document for.
        const opening =
          !text && element && !heading?.element.contains(element) ? blockOpening(element) : '';
        const location = [
          options.strings.refPage.replace('{0}', String(index + 1)),
          heading && options.strings.refUnder.replace('{0}', heading.text),
          opening && options.strings.refAt.replace('{0}', opening),
        ]
          .filter(Boolean)
          .join(', ');
        return text ? { location, text: quote(text) } : { location };
      },
      referenceMark(hit) {
        const page = hit.element.closest<HTMLElement>('.docx-wrapper > section.docx');
        const block = page && blockOf(hit.element);
        return block && page.contains(block) ? { element: block, page } : undefined;
      },
      navigation(context) {
        return headingsPane(context.viewport, outline(), options.strings);
      },
      summary: () => ({ format: 'docx', blocks: paragraphs().texts }),
      compare: (peer, side, context) => {
        if (peer.format !== 'docx') return undefined;
        // Versions compare by their text with all changes accepted; markup would muddle that.
        const shown = review.shown;
        review.setShown(false);
        const comparison = compareWord(paragraphs(), peer, side, context);
        return {
          ...comparison,
          dispose: () => {
            comparison.dispose();
            review.setShown(shown);
          },
        };
      },
      dispose() {
        navigator?.dispose();
        review.dispose();
      },
    };
  },
};

/**
 * The heading a place is under: the last one at or before `element`, or without an element the
 * last one that starts on or before page `page` (0-based).
 */
function headingBefore(
  headings: readonly Heading[],
  element: Element | undefined,
  page: number,
): Heading | undefined {
  let found: Heading | undefined;
  for (const heading of headings) {
    const before = element
      ? heading.element === element ||
        Boolean(
          heading.element.compareDocumentPosition(element) &
          (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY),
        )
      : heading.page <= page;
    if (!before) break;
    found = heading;
  }
  return found;
}

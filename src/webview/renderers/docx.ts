import { renderAsync } from 'docx-preview';
import type { ViewerStrings } from '../../shared/protocol';
import { adaptDocumentColors } from '../darkColors';
import { scrollTopOf } from '../diff/scrolling';
import { compareWord, wordBlocks, type WordBlocks } from '../diff/wordCompare';
import { findHeadings, headingClasses, type Heading } from '../docx/outline';
import { PageNavigator } from '../pageNavigator';
import { paginate } from '../paginate';
import { describe, pick } from '../picker';
import type { RenderContext, RenderedDocument, RenderOptions, Renderer } from './types';

/** Horizontal space around pages; matches the padding of `.docx-wrapper` in viewer.css. */
const PAGE_GUTTER = 2 * 32;

/** Canvas left visible above a heading gone to. */
const HEADING_MARGIN = 24;

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
      renderComments: false,
      renderChanges: false,
      // Embedded HTML chunks would need frames, which the webview's CSP blocks.
      renderAltChunks: false,
      useBase64URL: false,
      experimental: true,
    });

    // Page breaks depend on text metrics, so wait for the document's fonts first.
    await document.fonts.ready;
    const wrapper = target.querySelector<HTMLElement>('.docx-wrapper');
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
      },
      command(command) {
        if (command === 'goTo' && view) void goToHeading(view, outline(), options.strings);
      },
      summary: () => ({ format: 'docx', blocks: paragraphs().texts }),
      compare: (peer, side, context) =>
        peer.format === 'docx' ? compareWord(paragraphs(), peer, side, context) : undefined,
      dispose() {
        navigator?.dispose();
      },
    };
  },
};

/** Lists the headings to pick one from, opened on the one the view is under, and goes there. */
async function goToHeading(
  context: RenderContext,
  headings: readonly Heading[],
  strings: ViewerStrings,
): Promise<void> {
  const { viewport } = context;
  const top = (heading: Heading) =>
    scrollTopOf(viewport, heading.element.getBoundingClientRect().top);
  const at = viewport.scrollTop + HEADING_MARGIN + 1;
  const current = headings.reduce(
    (found, heading, index) => (top(heading) <= at ? index : found),
    -1,
  );
  const index = await pick(
    strings.goToHeading.replace('{0}', String(headings.length)),
    headings.map((heading, i) => ({
      // Indented by level, as in Word's navigation pane.
      label: `${' '.repeat(heading.level - 1)}${heading.text}`,
      description: describe(
        i === current && strings.current,
        strings.page.replace('{0}', String(heading.page + 1)),
      ),
      current: i === current,
    })),
  );
  if (index !== undefined) viewport.scrollTop = Math.max(0, top(headings[index]) - HEADING_MARGIN);
}

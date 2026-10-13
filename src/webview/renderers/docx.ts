import { renderAsync } from 'docx-preview';
import type { ViewerStrings } from '../../shared/protocol';
import { adaptDocumentColors } from '../darkColors';
import { scrollTopOf } from '../diff/scrolling';
import { compareWord, wordBlocks, type WordBlocks } from '../diff/wordCompare';
import { findHeadings, headingClasses, type Heading } from '../docx/outline';
import { WordReview } from '../docx/review';
import { PageNavigator } from '../pageNavigator';
import { paginate } from '../paginate';
import { describe, pick } from '../picker';
import { NavList } from '../navList';
import type {
  NavigationContent,
  RenderContext,
  RenderedDocument,
  RenderOptions,
  Renderer,
} from './types';

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
        if (command === 'goTo' && view) void goToHeading(view, outline(), options.strings);
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

/** Lists the headings to pick one from, opened on the one the view is under, and goes there. */
async function goToHeading(
  context: RenderContext,
  headings: readonly Heading[],
  strings: ViewerStrings,
): Promise<void> {
  const { viewport } = context;
  const current = currentHeading(viewport, headings);
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
  if (index !== undefined) revealHeading(viewport, headings[index]);
}

/** The headings in the navigation pane, as an outline that follows the view. */
function headingsPane(
  viewport: HTMLElement,
  headings: readonly Heading[],
  strings: ViewerStrings,
): NavigationContent {
  if (headings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'ov-nav-empty';
    empty.textContent = strings.noHeadings;
    return { title: strings.headings, element: empty, dispose: () => {} };
  }
  const list = new NavList(
    headings.map((heading) => ({ label: heading.text, level: heading.level })),
    {
      select: (index) => revealHeading(viewport, headings[index]),
      current: () => currentHeading(viewport, headings),
    },
    strings.headings,
    strings,
  );
  return { title: strings.headings, element: list.element, dispose: list.follow(viewport) };
}

const headingTop = (viewport: HTMLElement, heading: Heading) =>
  scrollTopOf(viewport, heading.element.getBoundingClientRect().top);

/** The heading the view is under: the last one at or above its top, or -1 before the first. */
function currentHeading(viewport: HTMLElement, headings: readonly Heading[]): number {
  const at = viewport.scrollTop + HEADING_MARGIN + 1;
  return headings.reduce(
    (found, heading, index) => (headingTop(viewport, heading) <= at ? index : found),
    -1,
  );
}

function revealHeading(viewport: HTMLElement, heading: Heading): void {
  viewport.scrollTop = Math.max(0, headingTop(viewport, heading) - HEADING_MARGIN);
}

import type { MarkdownIt } from 'markdown-it';
import type { ViewerStrings } from '../../shared/protocol';
import { quote } from '../../shared/reference';
import { isDarkTheme } from '../darkColors';
import { compareBlocks, type Blocks } from '../diff/blockCompare';
import { textOf } from '../diff/marks';
import { revealTop, scrollTopOf } from '../diff/scrolling';
import { goToHeading, headingsPane, type OutlineHeading } from '../headings';
import { icons } from '../icons';
import { markdownBlocks } from '../md/blocks';
import { highlightCode } from '../md/code';
import { splitFrontMatter } from '../md/frontmatter';
import { showPictures, type Pictures } from '../md/images';
import {
  lineAtTop,
  lineElement,
  lineLeaves,
  linesOf,
  revealLine,
  selectionLines,
  type LineRange,
} from '../md/lines';
import { anchorTarget, followLinks } from '../md/links';
import { createParser } from '../md/parse';
import { renderProperties } from '../md/properties';
import { sanitize } from '../md/sanitize';
import { describe } from '../picker';
import { selectedTextIn } from '../reference';
import { vscode } from '../vscodeApi';
import type { RenderContext, RenderedDocument, Renderer } from './types';

/** View state carried over when the file is rendered again (saved, theme changed). */
interface MarkdownState {
  /** The front matter is shown as YAML rather than as a list of properties. */
  source: boolean;
  /** The user chose to show this file's pictures from the web. */
  online: boolean;
}

/** How long a copy button says it copied. */
const COPIED_MS = 1500;

let parser: MarkdownIt | undefined;

export const mdRenderer: Renderer = {
  async render(data, target, options) {
    const { strings } = options;
    const text = decodeText(data).replace(/\r\n?/g, '\n');
    const sourceLines = text.split('\n');
    const { frontMatter, body } = splitFrontMatter(text);
    const html = (parser ??= createParser()).render(body);

    const page = document.createElement('div');
    page.className = 'md-page';
    const previous = options.previous as MarkdownState | undefined;
    const properties =
      frontMatter && renderProperties(frontMatter, strings, previous?.source ?? false);
    if (properties) page.append(properties.element);
    const article = document.createElement('article');
    article.className = 'md-body';
    article.append(sanitize(html));
    if (!text.trim()) {
      const empty = document.createElement('p');
      empty.className = 'md-empty';
      empty.textContent = strings.errorEmpty;
      article.append(empty);
    }
    page.append(article);
    target.append(page);

    decorate(article, strings);
    let view: RenderContext | undefined;
    const reveal = (anchor: string) => {
      const element = anchorTarget(article, anchor);
      if (!element || !view) return;
      revealTop(view.viewport, scrollTopOf(view.viewport, element.getBoundingClientRect().top));
    };
    followLinks(page, reveal);
    let online = Boolean(options.onlineContent || previous?.online);
    const [, pictures] = await Promise.all([
      highlightCode(page),
      showPictures(article, strings, isDarkTheme(), online),
    ]);
    if (pictures.hidden > 0) {
      page.prepend(
        onlineBar(pictures, strings, () => {
          online = true;
          forget();
        }),
      );
    }

    let headings: OutlineHeading[] | undefined;
    const outline = () => (headings ??= findHeadings(article));
    let leaves: HTMLElement[] | undefined;
    const placed = () => (leaves ??= lineLeaves(page));
    const forget = () => (leaves = undefined);

    return {
      naturalWidth: 0,
      adaptsColors: false,
      activate(context) {
        view = context;
        if (options.fragment) reveal(options.fragment);
        else if (options.line !== undefined) revealLine(context.viewport, placed(), options.line);
        // The front matter's list and its YAML take different room.
        properties?.element.querySelector('.md-props-toggle')?.addEventListener('click', forget);
      },
      refresh: forget,
      state: (): MarkdownState => ({ source: properties?.showingSource ?? false, online }),
      command(command) {
        if (command !== 'goTo' || !view) return;
        void goToHeading(view, outline(), strings, (heading, current) =>
          describe(
            current && strings.current,
            strings.refLine.replace('{0}', String(linesOf(heading.element).start + 1)),
          ),
        );
      },
      navigation: (context) => headingsPane(context.viewport, outline(), strings),
      sourceLine() {
        const line = view && lineAtTop(view.viewport, placed());
        return line === undefined ? undefined : Math.floor(line);
      },
      revealLine(line) {
        if (view) revealLine(view.viewport, placed(), line);
      },
      reference(hit, withText) {
        const selected = withText ? selectedTextIn(page) : '';
        const element = hit ? lineElement(hit.element, page) : topElement();
        const range = selectionLines(page) ?? (element ? linesOf(element) : undefined);
        if (!range) return undefined;
        const location = [lineLabel(trimmed(range), strings), placeOf(element)]
          .filter(Boolean)
          .join(', ');
        if (!withText) return { location };
        return { location, text: selected ? quote(selected) : sourceText(range, element) };
      },
      referenceMark(hit) {
        const element = lineElement(hit.element, page);
        return element ? { element, page } : undefined;
      },
      summary() {
        properties?.show(false);
        const { texts, pictures } = markdownBlocks(page);
        return { format: 'md', blocks: texts, pictures: pictures ?? [] };
      },
      compare(peer, side, context) {
        if (peer.format !== 'md') return undefined;
        // Versions compare by their properties, not by the YAML they were written in.
        properties?.show(false);
        forget();
        const blocks: Blocks = markdownBlocks(page);
        return compareBlocks(blocks, peer, side, context);
      },
    } satisfies RenderedDocument;

    /** The element at the top of the view, for references made from the Command Palette. */
    function topElement(): HTMLElement | undefined {
      if (!view) return undefined;
      const top = view.viewport.getBoundingClientRect().top;
      return placed().find((element) => element.getBoundingClientRect().bottom > top);
    }

    /** The lines of a range without the blank ones it ends with. */
    function trimmed({ start, end }: LineRange): LineRange {
      let last = Math.min(end, sourceLines.length);
      while (last > start + 1 && !sourceLines[last - 1].trim()) last--;
      return { start, end: last };
    }

    /** What the place is in: a front matter property, or the section under a heading. */
    function placeOf(element: HTMLElement | undefined): string {
      const property = element?.closest<HTMLElement>(
        '.md-props-list:not(.md-props-nested) > .md-prop',
      );
      if (property?.dataset.key) return strings.refProperty.replace('{0}', property.dataset.key);
      if (!element || !article.contains(element)) return '';
      const heading = headingBefore(outline(), element);
      return heading && !heading.element.contains(element)
        ? strings.refUnder.replace('{0}', heading.text)
        : '';
    }

    /** The Markdown the lines hold, quoted, or as a code block when they are code. */
    function sourceText(range: LineRange, element: HTMLElement | undefined): string {
      const { start, end } = trimmed(range);
      const lines = sourceLines.slice(start, end);
      const code = element?.closest<HTMLElement>('.md-code');
      if (code && element?.classList.contains('md-line')) {
        return ['```' + (code.dataset.lang ?? ''), ...lines, '```'].join('\n');
      }
      return lines.map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
    }
  },
};

/** `line 12` or `lines 12-18`, counted from 1 as editors do. */
function lineLabel({ start, end }: LineRange, strings: ViewerStrings): string {
  return end - start <= 1
    ? strings.refLine.replace('{0}', String(start + 1))
    : strings.refLines.replace('{0}', String(start + 1)).replace('{1}', String(end));
}

/** UTF-8 by default; a byte order mark says otherwise. */
function decodeText(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder('utf-16be').decode(data.subarray(2));
  return new TextDecoder().decode(data);
}

/** Headings in order, levels counted from the highest one used. */
function findHeadings(article: HTMLElement): OutlineHeading[] {
  const elements = [...article.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
  const levels = elements.map((element) => Number(element.tagName[1]));
  const top = Math.min(...levels);
  return elements
    .map((element, i) => ({
      element,
      level: levels[i] - top + 1,
      text: textOf(element).replace(/\s+/g, ' ').trim(),
    }))
    .filter((heading) => heading.text);
}

function headingBefore(
  headings: readonly OutlineHeading[],
  element: Element,
): OutlineHeading | undefined {
  let found: OutlineHeading | undefined;
  for (const heading of headings) {
    const before =
      heading.element === element ||
      Boolean(
        heading.element.compareDocumentPosition(element) &
        (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY),
      );
    if (!before) break;
    found = heading;
  }
  return found;
}

/**
 * The bar above a file with pictures from the web, which stay hidden so that the viewer doesn't
 * go online on its own; its button shows them. The setting shows them without asking.
 */
function onlineBar(pictures: Pictures, strings: ViewerStrings, shown: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'md-online';
  bar.setAttribute('role', 'note');
  bar.innerHTML = icons.globe;
  const text = document.createElement('span');
  text.className = 'md-online-text';
  text.textContent = strings.onlineContentHidden;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ov-button md-online-show';
  button.textContent = strings.showOnlineContent;
  button.title = strings.showOnlineContentHint;
  button.addEventListener('click', () => {
    pictures.showOnline();
    bar.remove();
    shown();
  });
  bar.append(text, button);
  return bar;
}

const ALERT_ICONS: Record<string, string> = {
  note: icons.note,
  tip: icons.tip,
  important: icons.important,
  warning: icons.warning,
  caution: icons.caution,
};

/** Puts in what sanitizing would have taken out: task boxes, icons, code block buttons. */
function decorate(article: HTMLElement, strings: ViewerStrings): void {
  // Drawn rather than an <input>, so it follows the theme; read-only, as the view is.
  for (const box of article.querySelectorAll<HTMLElement>('.md-task-box')) {
    const checked = box.dataset.checked === 'true';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(checked));
    box.setAttribute('aria-readonly', 'true');
    if (checked) box.innerHTML = icons.check;
  }
  // Raw HTML spanning Markdown carries its lines on a marker; the element after it takes them.
  for (const marker of article.querySelectorAll<HTMLElement>('.md-html-line')) {
    const next = marker.nextElementSibling;
    if (next instanceof HTMLElement && next.dataset.line === undefined) {
      next.dataset.line = marker.dataset.line;
      next.dataset.lineEnd = marker.dataset.lineEnd;
    }
  }
  for (const title of article.querySelectorAll<HTMLElement>('.md-alert-title')) {
    title.insertAdjacentHTML('afterbegin', ALERT_ICONS[title.dataset.alert ?? ''] ?? '');
  }
  for (const block of article.querySelectorAll<HTMLElement>('.md-code')) {
    const header = document.createElement('div');
    header.className = 'md-code-header';
    const language = document.createElement('span');
    language.className = 'md-code-lang';
    language.textContent = block.dataset.lang ?? '';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ov-icon-button md-code-copy';
    copy.innerHTML = icons.copy;
    copy.title = strings.copyCode;
    copy.setAttribute('aria-label', strings.copyCode);
    let timer: ReturnType<typeof setTimeout> | undefined;
    copy.addEventListener('click', () => {
      const lines = [...block.querySelectorAll('.md-line')].map((line) => line.textContent ?? '');
      vscode.postMessage({ type: 'copyText', text: lines.join('').replace(/\n$/, '') });
      copy.innerHTML = icons.check;
      copy.title = strings.copied;
      clearTimeout(timer);
      timer = setTimeout(() => {
        copy.innerHTML = icons.copy;
        copy.title = strings.copyCode;
      }, COPIED_MS);
    });
    header.append(language, copy);
    block.prepend(header);
  }
}

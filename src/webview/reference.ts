import { NOT_TEXT, OBJECT, textOf } from './diff/marks';

/** Where the user last right-clicked, for the copy commands the context menu runs next. */
export interface ContextTarget {
  element: Element;
  x: number;
  y: number;
}

/** What a reference points at, and the page or slide (positioned) to draw its mark in. */
export interface MarkTarget {
  element: Element;
  page: HTMLElement;
}

let last: ContextTarget | undefined;

/** Room between a paragraph and its mark, in CSS pixels at 100% zoom. */
const MARK_PADDING = 3;
/** How long a mark stays after a copy, fade included; matches `.ov-ref-mark-fading`. */
const FADE_MS = 1600;

let mark: HTMLElement | undefined;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Remembers right-clicks inside `root`; VS Code's context menu reports only the command. What
 * `markOf` returns for a right-click is marked, so the user sees what a reference would point at.
 */
export function trackContextMenu(
  root: HTMLElement,
  markOf: (hit: ContextTarget) => MarkTarget | undefined,
): void {
  root.addEventListener('contextmenu', (event) => {
    last =
      event.target instanceof Element
        ? { element: event.target, x: event.clientX, y: event.clientY }
        : undefined;
    const target = last && markOf(last);
    setMark(target && drawMark(target));
  });
  // The next click or key press moves on from the menu, whether a command ran or not.
  window.addEventListener('pointerdown', () => setMark(undefined));
  window.addEventListener('keydown', () => setMark(undefined));
}

/** Once a reference is copied, its mark has done its job: let it fade out. */
export function fadeMark(): void {
  if (!mark || fadeTimer) return;
  mark.classList.add('ov-ref-mark-fading');
  fadeTimer = setTimeout(() => setMark(undefined), FADE_MS);
}

function setMark(next: HTMLElement | undefined): void {
  clearTimeout(fadeTimer);
  fadeTimer = undefined;
  mark?.remove();
  mark = next;
}

/**
 * A box over `element`, drawn in `page` rather than styled on the element itself: a paragraph's
 * own shading stays, and list bullets, which a hanging indent puts left of it, are included.
 */
function drawMark({ element, page }: MarkTarget): HTMLElement {
  const area = page.getBoundingClientRect();
  // Content is scaled with CSS `zoom`; positions inside the page are at 100%.
  const scale = area.width / page.offsetWidth || 1;
  const box = element.getBoundingClientRect();
  const indent = Math.min(0, parseFloat(getComputedStyle(element).textIndent) || 0);
  const left = Math.max(0, (box.left - area.left) / scale + indent - MARK_PADDING);
  const top = Math.max(0, (box.top - area.top) / scale - MARK_PADDING);
  const right = Math.min(page.clientWidth, (box.right - area.left) / scale + MARK_PADDING);
  const bottom = Math.min(page.clientHeight, (box.bottom - area.top) / scale + MARK_PADDING);
  const drawn = document.createElement('div');
  drawn.className = 'ov-ref-mark';
  drawn.setAttribute(NOT_TEXT, '');
  drawn.setAttribute('aria-hidden', 'true');
  Object.assign(drawn.style, {
    left: `${left - page.clientLeft}px`,
    top: `${top - page.clientTop}px`,
    width: `${right - left}px`,
    height: `${bottom - top}px`,
  });
  page.append(drawn);
  return drawn;
}

/** The last right-click, as long as what it hit is still on screen. */
export function lastContextTarget(): ContextTarget | undefined {
  return last?.element.isConnected ? last : undefined;
}

/** The text the user selected inside `root`, or '' when nothing there is selected. */
export function selectedTextIn(root: Element): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return '';
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? selection.toString().trim() : '';
}

const BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6';

/** The paragraph, list item or table cell an element is in. */
export function blockOf(element: Element): Element | null {
  return element.closest(BLOCK);
}

/** The paragraph, list item or table cell an element is in, as one line of text. */
export function blockText(element: Element): string {
  return oneLine(textOf(blockOf(element) ?? element));
}

/** Words enough to find a paragraph again by searching for them, yet short in a location. */
const OPENING_WORDS = 8;

/** How the paragraph or table cell an element is in begins, or '' outside one. */
export function blockOpening(element: Element): string {
  const block = blockOf(element);
  const words = block ? oneLine(textOf(block)).split(' ').filter(Boolean) : [];
  return words.length > OPENING_WORDS
    ? `${words.slice(0, OPENING_WORDS).join(' ')}…`
    : words.join(' ');
}

/** The text of an element with pictures left out and each block on its own line. */
export function blockLines(element: Element): string {
  return textOf(element).split('\n').map(oneLine).filter(Boolean).join('\n');
}

function oneLine(text: string): string {
  return text.replaceAll(OBJECT, '').replace(/\s+/g, ' ').trim();
}

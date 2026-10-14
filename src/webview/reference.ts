import { OBJECT, textOf } from './diff/marks';

/** Where the user last right-clicked, for the copy commands the context menu runs next. */
export interface ContextTarget {
  element: Element;
  x: number;
  y: number;
}

let last: ContextTarget | undefined;

/** Remembers right-clicks inside `root`; VS Code's context menu reports only the command. */
export function trackContextMenu(root: HTMLElement): void {
  root.addEventListener('contextmenu', (event) => {
    last =
      event.target instanceof Element
        ? { element: event.target, x: event.clientX, y: event.clientY }
        : undefined;
  });
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

/** The paragraph, list item or table cell an element is in, as one line of text. */
export function blockText(element: Element): string {
  return oneLine(textOf(element.closest(BLOCK) ?? element));
}

/** The text of an element with pictures left out and each block on its own line. */
export function blockLines(element: Element): string {
  return textOf(element).split('\n').map(oneLine).filter(Boolean).join('\n');
}

function oneLine(text: string): string {
  return text.replaceAll(OBJECT, '').replace(/\s+/g, ' ').trim();
}

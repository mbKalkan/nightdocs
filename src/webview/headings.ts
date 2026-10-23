import type { PickItem, ViewerStrings } from '../shared/protocol';
import { scrollTopOf } from './diff/scrolling';
import { NavList } from './navList';
import { pick } from './picker';
import type { NavigationContent, RenderContext } from './renderers/types';

/** A heading of a Word or Markdown document, for the navigation pane and Go to Heading. */
export interface OutlineHeading {
  element: HTMLElement;
  /** 1 for the top level, and so on. */
  level: number;
  text: string;
}

/** Canvas left visible above a heading gone to. */
const HEADING_MARGIN = 24;

/**
 * Lists the headings to pick one from, opened on the one the view is under, and goes there.
 * `describe` adds to an entry what tells headings apart, such as the page it is on.
 */
export async function goToHeading<T extends OutlineHeading>(
  context: RenderContext,
  headings: readonly T[],
  strings: ViewerStrings,
  describe: (heading: T, current: boolean) => PickItem['description'],
): Promise<void> {
  const { viewport } = context;
  const current = currentHeading(viewport, headings);
  const index = await pick(
    strings.goToHeading.replace('{0}', String(headings.length)),
    headings.map((heading, i) => ({
      // Indented by level, as in Word's navigation pane; an em space, which quick picks keep.
      label: `${' '.repeat(heading.level - 1)}${heading.text}`,
      description: describe(heading, i === current),
      current: i === current,
    })),
  );
  if (index !== undefined) revealHeading(viewport, headings[index]);
}

/** The headings in the navigation pane, as an outline that follows the view. */
export function headingsPane(
  viewport: HTMLElement,
  headings: readonly OutlineHeading[],
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

const headingTop = (viewport: HTMLElement, heading: OutlineHeading) =>
  scrollTopOf(viewport, heading.element.getBoundingClientRect().top);

/** The heading the view is under: the last one at or above its top, or -1 before the first. */
export function currentHeading(viewport: HTMLElement, headings: readonly OutlineHeading[]): number {
  const at = viewport.scrollTop + HEADING_MARGIN + 1;
  return headings.reduce(
    (found, heading, index) => (headingTop(viewport, heading) <= at ? index : found),
    -1,
  );
}

export function revealHeading(viewport: HTMLElement, heading: OutlineHeading): void {
  viewport.scrollTop = Math.max(0, headingTop(viewport, heading) - HEADING_MARGIN);
}

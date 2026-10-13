import { OBJECT, textOf } from '../diff/marks';

/** The parts of docx-preview's parsed document this reads. */
interface ParsedDocument {
  stylesPart?: {
    styles?: {
      id?: string | null;
      name?: string | null;
      basedOn?: string | null;
      target?: string | null;
      paragraphProps?: { outlineLevel?: number };
    }[];
  };
}

export interface Heading {
  element: HTMLElement;
  /** 1 for Heading 1, and so on. */
  level: number;
  text: string;
  /** The page it is on (0-based). */
  page: number;
}

/** How docx-preview turns a style id into a class name (`docx_heading1`). */
const styleClass = (id: string) =>
  `docx_${id.replace(/[ .]+/g, '-').replace(/[&]+/g, 'and').toLowerCase()}`;

/**
 * The outline level of each paragraph style that has one, by its class name. Built-in heading
 * styles are named "heading 1" to "heading 9" whatever the language of Word; other styles can
 * set an outline level themselves or inherit one.
 */
export function headingClasses(document: unknown): Map<string, number> {
  const styles = (document as ParsedDocument | undefined)?.stylesPart?.styles ?? [];
  const byId = new Map(styles.filter((style) => style.id).map((style) => [style.id!, style]));
  const levelOf = (id: string, seen = new Set<string>()): number | undefined => {
    const style = byId.get(id);
    if (!style || seen.has(id)) return undefined;
    seen.add(id);
    const named = /^heading ([1-9])$/i.exec(style.name ?? '');
    if (named) return Number(named[1]);
    const outline = style.paragraphProps?.outlineLevel;
    // Level 9 is body text.
    if (outline !== undefined) return outline < 9 ? outline + 1 : undefined;
    return style.basedOn ? levelOf(style.basedOn, seen) : undefined;
  };
  const classes = new Map<string, number>();
  for (const [id, style] of byId) {
    if (style.target !== 'p') continue;
    const level = levelOf(id);
    if (level !== undefined) classes.set(styleClass(id), level);
  }
  return classes;
}

/** The headings of the document body, page by page, as Word's navigation pane lists them. */
export function findHeadings(
  pages: readonly HTMLElement[],
  classes: Map<string, number>,
): Heading[] {
  const headings: Heading[] = [];
  if (classes.size === 0) return headings;
  pages.forEach((page, index) => {
    for (const element of page.querySelectorAll<HTMLElement>(':scope > article p')) {
      const level = [...element.classList].map((name) => classes.get(name)).find(Boolean);
      if (level === undefined) continue;
      const text = textOf(element).replaceAll(OBJECT, '').replace(/\s+/g, ' ').trim();
      if (text) headings.push({ element, level, text, page: index });
    }
  });
  return headings;
}

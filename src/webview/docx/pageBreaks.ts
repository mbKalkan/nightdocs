/** The parts of docx-preview's parsed elements this reads and changes. */
export interface ParsedElement {
  type: string;
  children?: ParsedElement[];
  break?: string;
  text?: string;
  className?: string;
  pageBreakBefore?: boolean;
  sectionProps?: unknown;
}

interface ParsedDocument {
  documentPart?: { body?: { children?: ParsedElement[] } };
}

/** Class of the part of a paragraph that goes on after a page break: no number, no first line. */
export const CONTINUED = 'ng-continued';

/** Elements that show nothing on the page. */
const MARKERS = new Set([
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'complexField',
  'instruction',
]);

/** Elements that only hold others. */
const CONTAINERS = new Set(['run', 'hyperlink', 'smartTag', 'inserted', 'deleted']);

/** A break docx-preview starts a new page at (with Word's saved breaks turned on). */
const isPageBreak = (element: ParsedElement) =>
  element.type === 'break' &&
  (element.break === 'page' || element.break === 'lastRenderedPageBreak');

function shows(element: ParsedElement): boolean {
  if (MARKERS.has(element.type)) return false;
  if (element.type === 'text') return Boolean(element.text);
  if (element.type === 'break') return element.break !== 'lastRenderedPageBreak';
  if (CONTAINERS.has(element.type)) return (element.children ?? []).some(shows);
  return true;
}

/** Where docx-preview would break the paragraph: the first run holding a page break. */
function findBreak(paragraph: ParsedElement): { child: number; index: number } | undefined {
  const children = paragraph.children ?? [];
  for (let child = 0; child < children.length; child++) {
    const index = children[child]!.children?.findIndex(isPageBreak) ?? -1;
    if (index !== -1) return { child, index };
  }
  return undefined;
}

/**
 * Splits paragraphs at their page breaks the way Word lays them out, before docx-preview does.
 * docx-preview copies the whole paragraph into both halves, so a numbered paragraph took two
 * numbers: one for an empty half when Word's saved break sits at its start (every later clause
 * was then off by one), one more for its second half. Here a break at the start becomes a page
 * break before the paragraph, and the second half is marked as continued.
 */
export function splitAtPageBreaks(document: unknown): void {
  const body = (document as ParsedDocument | undefined)?.documentPart?.body;
  if (!body?.children) return;
  body.children = body.children.flatMap((element) =>
    element.type === 'paragraph' ? splitParagraph(element) : [element],
  );
}

export function splitParagraph(paragraph: ParsedElement): ParsedElement[] {
  const found = findBreak(paragraph);
  if (!found) return [paragraph];
  const children = paragraph.children!;
  const run = children[found.child]!;
  const runChildren = run.children!;
  const before = [
    ...children.slice(0, found.child),
    { ...run, children: runChildren.slice(0, found.index) },
  ];
  const after = [
    { ...run, children: runChildren.slice(found.index + 1) },
    ...children.slice(found.child + 1),
  ];
  // docx-preview handles a paragraph that only holds a break, or ends with one, without copying it.
  if (!after.some(shows)) return [paragraph];

  if (!before.some(shows)) {
    return splitParagraph({ ...paragraph, pageBreakBefore: true, children: [...before, ...after] });
  }

  // The break ends the first half, which docx-preview then ends the page with, unsplit.
  const first: ParsedElement = {
    ...paragraph,
    sectionProps: undefined,
    children: [
      ...children.slice(0, found.child),
      { ...run, children: runChildren.slice(0, found.index + 1) },
    ],
  };
  const rest: ParsedElement = {
    ...paragraph,
    pageBreakBefore: false,
    className: [paragraph.className, CONTINUED].filter(Boolean).join(' '),
    children: after,
  };
  return [first, ...splitParagraph(rest)];
}

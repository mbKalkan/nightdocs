// Word records where it broke pages when it last saved a document, and docx-preview starts a
// new page there. Documents Word never laid out (exports from other apps, generated files)
// have no such marks and come out as one long page; this splits those into pages of their
// paper size, between blocks and between table rows.

/**
 * A page this many times taller than its paper was never paginated. A page that is only a
 * little too tall was laid out by Word with other fonts and is left alone, so it doesn't
 * turn into a full page plus a page with a line or two.
 */
const UNPAGINATED = 1.5;

type Break = Element;

/** Splits overlong pages in a rendered `.docx-wrapper`. Needs layout, so run it on screen. */
export function paginate(wrapper: HTMLElement): void {
  for (const section of wrapper.querySelectorAll<HTMLElement>(':scope > section.docx')) {
    const style = getComputedStyle(section);
    const pageHeight = parseFloat(style.minHeight);
    const article = section.querySelector<HTMLElement>(':scope > article');
    if (!article || !(pageHeight > 0) || section.offsetHeight <= pageHeight * UNPAGINATED) {
      continue;
    }
    const room = pageHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (room > 0) splitSection(section, article, findBreaks(article, room));
  }
}

/**
 * Where new pages start, measured in one pass over the current layout: an element that
 * begins a page, or a table row that does.
 */
function findBreaks(article: HTMLElement, room: number): Break[] {
  const origin = article.getBoundingClientRect().top;
  const breaks: Break[] = [];
  let pageTop = 0;
  /** Blocks already on the current page; a page never starts with a break. */
  let onPage = 0;
  let forced = false;
  for (const block of article.children) {
    const { top, bottom } = offsets(block, origin);
    if (forced && onPage > 0) {
      breaks.push(block);
      pageTop = top;
      onPage = 0;
    }
    forced = false;
    if (bottom - pageTop > room) {
      if (block instanceof HTMLTableElement) {
        for (const [index, row] of [...block.rows].entries()) {
          const cell = offsets(row, origin);
          if (cell.bottom - pageTop <= room) continue;
          // Breaking before the first row moves the whole table, unless it starts the page.
          if (index === 0 && onPage === 0) continue;
          breaks.push(index === 0 ? block : row);
          pageTop = cell.top;
          onPage = 0;
        }
      } else if (onPage > 0) {
        breaks.push(block);
        pageTop = top;
        onPage = 0;
      }
      // A block taller than a page keeps that page to itself.
      forced = bottom - pageTop > room;
    }
    onPage++;
  }
  return breaks;
}

function offsets(element: Element, origin: number): { top: number; bottom: number } {
  const rect = element.getBoundingClientRect();
  return { top: rect.top - origin, bottom: rect.bottom - origin };
}

function splitSection(section: HTMLElement, article: HTMLElement, breaks: Break[]): void {
  if (breaks.length === 0) return;
  const header = section.querySelector(':scope > header');
  const footer = section.querySelector(':scope > footer');
  // Footnotes and endnotes rendered after the text go to the last page.
  const notes = [...section.children].filter(
    (child) => child !== header && child !== footer && child !== article,
  );

  // From the last break back, so every block moves once and each new page goes right after
  // the original one, ahead of the pages made before it.
  let last: HTMLElement | undefined;
  for (const start of [...breaks].reverse()) {
    const page = section.cloneNode(false) as HTMLElement;
    const content = article.cloneNode(false) as HTMLElement;
    if (header) page.append(header.cloneNode(true));
    page.append(content);
    if (footer) page.append(footer.cloneNode(true));
    section.after(page);
    last ??= page;

    const first = start instanceof HTMLTableRowElement ? splitTable(start) : start;
    for (let node: Node | null = first; node;) {
      const following: Node | null = node.nextSibling;
      content.append(node);
      node = following;
    }
  }
  if (last) {
    const lastFooter = last.querySelector(':scope > footer');
    if (lastFooter) lastFooter.before(...notes);
    else last.append(...notes);
  }
}

/** Moves `row` and the rows after it into a copy of their table, placed right after it. */
function splitTable(row: HTMLTableRowElement): HTMLTableElement {
  const table = row.closest('table') as HTMLTableElement;
  const rest = table.cloneNode(false) as HTMLTableElement;
  for (const columns of table.querySelectorAll(':scope > colgroup')) {
    rest.append(columns.cloneNode(true));
  }
  const rows = [...table.rows];
  const groups = new Map<Element, Element>();
  for (const moved of rows.slice(rows.indexOf(row))) {
    const parent = moved.parentElement as Element;
    if (parent === table) {
      rest.append(moved);
      continue;
    }
    let group = groups.get(parent);
    if (!group) {
      group = parent.cloneNode(false) as Element;
      groups.set(parent, group);
      rest.append(group);
    }
    group.append(moved);
  }
  table.after(rest);
  return rest;
}

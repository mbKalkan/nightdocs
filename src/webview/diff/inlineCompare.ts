import { similarity } from '../../shared/diff';
import type { Comparison, RenderContext } from '../renderers/types';
import { align, EDITED } from './align';
import { blockKeys, markPictures, type Blocks } from './blockCompare';
import { clearMarks, markWords } from './marks';
import type { OverviewMark } from './overview';
import { revealByTops, revealTop, scrollTopOf } from './scrolling';

const LINE = 'nd-diff-line';
const REMOVED = 'nd-diff-removed';
const ADDED = 'nd-diff-added';
const CLASSES = [LINE, REMOVED, ADDED];

/** Marks what an inline comparison put into the modified version, so it can be taken out. */
const INSERTED = 'nd-inline-inserted';

/** Attributes a copy of an original block can't keep: ids and anchors would clash, lines differ. */
const OWN_ATTRIBUTES = ['id', 'data-line', 'data-line-end', 'data-anchor'];

interface Change {
  /** The first and last element of the change, in reading order. */
  first: HTMLElement;
  last: HTMLElement;
  removed: boolean;
  added: boolean;
}

/**
 * Shows the differences between two versions in the modified one, as VS Code's inline diff
 * does: each block of the original that was removed or edited is copied in, marked as removed,
 * just above where it was; blocks that are new or edited are marked as added.
 */
export function compareInline(
  original: Blocks,
  modified: Blocks,
  context: RenderContext,
  onChange: () => void,
): Comparison {
  const alignment = align(
    blockKeys(original.texts, original.pictures),
    blockKeys(modified.texts, modified.pictures),
    {
      score: (x, y) => similarity(original.texts[x], modified.texts[y]),
    },
  );
  const placer = new Placer(original.root, modified.root);
  const changes: Change[] = [];
  // Copies of list items go into the lists; the items there keep their numbers.
  const numbered = numberItems(modified.root);

  for (const hunk of alignment.hunks) {
    const pairs = new Map(hunk.pairs);
    const pairedWith = new Map(hunk.pairs.map(([a, b]) => [b, a]));
    for (let b = hunk.bStart; b < hunk.bEnd; b++) {
      const element = modified.elements[b];
      element.classList.add(LINE, ADDED);
      const a = pairedWith.get(b);
      if (a !== undefined) markEdit(element, original, modified, a, b, ADDED);
    }
    // Removed blocks go before the next block of the modified version, an edited one just
    // before its new version. Short blocks replaced one for one (a heading for a heading)
    // count as removed, so that what was removed stays together.
    const copies: HTMLElement[] = [];
    let next = hunk.bStart;
    for (let a = hunk.aStart; a < hunk.aEnd; a++) {
      const element = original.elements[a];
      element.classList.add(LINE, REMOVED);
      let b = pairs.get(a);
      if (b !== undefined) markEdit(element, modified, original, b, a, REMOVED);
      if (b !== undefined && similarity(original.texts[a], modified.texts[b]) < EDITED) {
        b = undefined;
      }
      const at = b ?? next;
      copies.push(
        at < modified.elements.length
          ? placer.place(element, modified.elements[at], false)
          : placer.place(element, modified.elements[modified.elements.length - 1], true),
      );
      if (b !== undefined) next = b + 1;
    }
    const shown = [...copies, ...modified.elements.slice(hunk.bStart, hunk.bEnd)].sort(
      inReadingOrder,
    );
    if (shown.length === 0) continue;
    changes.push({
      first: shown[0],
      last: shown[shown.length - 1],
      removed: hunk.aEnd > hunk.aStart,
      added: hunk.bEnd > hunk.bStart,
    });
  }
  onChange();

  const { viewport } = context;
  const top = (element: HTMLElement) => scrollTopOf(viewport, element.getBoundingClientRect().top);
  const bottom = (element: HTMLElement) =>
    scrollTopOf(viewport, element.getBoundingClientRect().bottom);
  return {
    count: changes.length,
    go: (direction) =>
      revealByTops(
        viewport,
        changes.map(({ first }) => top(first)),
        direction,
      ),
    goTo: (index) => revealTop(viewport, top(changes[index].first)),
    // Nothing beside it to scroll along.
    anchor: () => undefined,
    scrollTo: () => undefined,
    overview: () =>
      changes.map(({ first, last, removed, added }): OverviewMark => ({
        top: top(first),
        bottom: bottom(last),
        removed,
        added,
      })),
    dispose() {
      for (const element of modified.root.querySelectorAll(`.${INSERTED}`)) element.remove();
      for (const item of numbered) item.removeAttribute('value');
      clearMarks(original.root, CLASSES);
      clearMarks(modified.root, CLASSES);
      onChange();
    },
  };
}

/** Marks the words of an edited block that its other version doesn't have, and its pictures. */
function markEdit(
  element: HTMLElement,
  other: Blocks,
  own: Blocks,
  otherIndex: number,
  ownIndex: number,
  className: string,
): void {
  markWords(element, other.texts[otherIndex], className);
  if ((own.pictures?.[ownIndex] ?? '') !== (other.pictures?.[otherIndex] ?? '')) {
    markPictures(element, className);
  }
}

/** Numbers the items of numbered lists as they are, and returns the items numbered. */
function numberItems(root: Element): HTMLLIElement[] {
  const items: HTMLLIElement[] = [];
  for (const list of root.querySelectorAll('ol')) {
    [...list.children].forEach((item, i) => {
      if (!(item instanceof HTMLLIElement) || item.hasAttribute('value')) return;
      item.value = list.start + i;
      items.push(item);
    });
  }
  return items;
}

const inReadingOrder = (a: Node, b: Node) =>
  a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

/** The elements from just inside `root` down to `element`. */
function chain(element: HTMLElement, root: Element): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (let node: HTMLElement | null = element; node && node !== root; node = node.parentElement) {
    result.unshift(node);
  }
  return result;
}

/** What makes two containers the same kind: a list, a table, a code block, a callout. */
const kind = (element: Element) =>
  `${element.tagName} ${[...element.classList].filter((c) => !c.startsWith('nd-')).sort()}`;

/**
 * Copies blocks of the original version into the modified one, inside the same kind of
 * containers: a removed list item into the list (or a list of its own), a row into the table,
 * a line of code into the code block. Blocks copied one after another to the same place share
 * their containers.
 */
class Placer {
  /** The last copy put in: its outermost element, and the containers made for it by original. */
  private last: { top: HTMLElement; copies: Map<HTMLElement, HTMLElement> } | undefined;
  /** Where the next copy after an element goes, so that copies after it stay in order. */
  private readonly after = new Map<Node, Node>();

  constructor(
    private readonly originalRoot: Element,
    private readonly modifiedRoot: Element,
  ) {}

  /** Puts a copy of the original `block` before (or `after`) the modified `anchor`. */
  place(block: HTMLElement, anchor: HTMLElement | undefined, after: boolean): HTMLElement {
    const sources = chain(block, this.originalRoot);
    const targets = anchor ? chain(anchor, this.modifiedRoot) : [];
    // Go into the same containers, but not into the list item a paragraph is the text of: an
    // item of its own reads better.
    let depth = 0;
    while (
      depth < sources.length - 1 &&
      depth < targets.length - 1 &&
      !(sources[depth].tagName === 'LI' && depth === sources.length - 2) &&
      kind(sources[depth]) === kind(targets[depth])
    ) {
      depth++;
    }
    // With nothing to go before (an empty file), copies go into the body.
    const parent: Node =
      depth > 0
        ? targets[depth - 1]
        : targets.length > 0
          ? this.modifiedRoot
          : (this.modifiedRoot.querySelector('.md-body') ?? this.modifiedRoot);
    const reference = targets[depth];
    let place: Node | null = reference ?? null;
    if (after && reference) place = (this.after.get(reference) ?? reference).nextSibling;

    const wrappers = sources.slice(depth, -1);
    const copy = copyOf(block, true);
    // Share the containers of the copy just before this place.
    const last = this.last;
    if (last && last.top.parentNode === parent && last.top.nextSibling === place) {
      let k = wrappers.length;
      while (k > 0 && !last.copies.has(wrappers[k - 1])) k--;
      if (k > 0) {
        const into = last.copies.get(wrappers[k - 1])!;
        into.append(this.wrap(copy, wrappers.slice(k), last.copies));
        return copy;
      }
    }
    const copies = new Map<HTMLElement, HTMLElement>();
    const top = this.wrap(copy, wrappers, copies);
    top.classList.add(INSERTED);
    parent.insertBefore(top, place);
    if (after && reference) this.after.set(reference, top);
    this.last = { top, copies };
    return copy;
  }

  /** Puts `copy` inside copies of `wrappers` (outermost first) and returns the outermost. */
  private wrap(
    copy: HTMLElement,
    wrappers: HTMLElement[],
    copies: Map<HTMLElement, HTMLElement>,
  ): HTMLElement {
    let inner = copy;
    for (let i = wrappers.length - 1; i >= 0; i--) {
      const wrapper = copyOf(wrappers[i], false);
      wrapper.append(inner);
      copies.set(wrappers[i], wrapper);
      inner = wrapper;
    }
    if (copy === inner) copy.classList.add(INSERTED);
    return inner;
  }
}

/** A copy of an element of the original version, fit to sit in the modified one. */
function copyOf(element: HTMLElement, deep: boolean): HTMLElement {
  const copy = element.cloneNode(deep) as HTMLElement;
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    for (const name of OWN_ATTRIBUTES) node.removeAttribute(name);
  }
  // A list item keeps its number; a collapsed section shows what changed in it.
  if (element instanceof HTMLLIElement && element.parentElement instanceof HTMLOListElement) {
    const items = [...element.parentElement.children];
    (copy as HTMLLIElement).value = element.parentElement.start + items.indexOf(element);
  }
  if (copy instanceof HTMLDetailsElement) copy.open = true;
  return copy;
}

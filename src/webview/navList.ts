import type { ViewerStrings } from '../shared/protocol';
import { icons } from './icons';

export interface NavEntry {
  label: string;
  /** Nesting, from 1; entries under one with a lower level can be collapsed into it. */
  level?: number;
  /** Shown before the label: a slide's picture, a sheet's tab color. */
  decoration?: HTMLElement;
  /** Shown dimmed, like a hidden slide. */
  muted?: boolean;
}

export interface NavActions {
  /** Brings an entry into view in the document. */
  select(index: number): void;
  /** The entry the document is at now, or -1. */
  current(): number;
}

/**
 * The list in the navigation pane: headings, slides or sheets. A tree in the ARIA sense, with
 * one tab stop; arrow keys move through it and go there, as PowerPoint's slide pane does, and
 * Left/Right collapse and expand headings.
 */
export class NavList {
  readonly element: HTMLElement;
  private readonly rows: HTMLElement[];
  private readonly collapsed = new Set<number>();
  private shown = -1;

  constructor(
    private readonly entries: readonly NavEntry[],
    private readonly actions: NavActions,
    label: string,
    private readonly strings: ViewerStrings,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'ov-nav-list';
    this.element.setAttribute('role', 'tree');
    this.element.setAttribute('aria-label', label);
    this.rows = entries.map((entry, index) => this.row(entry, index));
    this.element.append(...this.rows);
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.layout();
    this.update();
  }

  /** Keeps the entry the document is at marked as the viewport scrolls; returns how to stop. */
  follow(viewport: HTMLElement): () => void {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.update());
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', onScroll);
    };
  }

  /** Marks the entry the document is at, and keeps it in sight in the pane. */
  update(): void {
    let index = this.actions.current();
    // Under a collapsed heading, its visible ancestor stands for it.
    while (index >= 0 && this.rows[index]?.hidden) index = this.parent(index);
    if (index === this.shown) return;
    this.rows[this.shown]?.removeAttribute('aria-current');
    this.rows[index]?.setAttribute('aria-current', 'location');
    this.shown = index;
    if (!this.element.contains(document.activeElement)) this.setTabStop(Math.max(0, index));
    this.rows[index]?.scrollIntoView({ block: 'nearest' });
  }

  private row(entry: NavEntry, index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ov-nav-item';
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(entry.level ?? 1));
    row.setAttribute('aria-selected', 'false');
    row.tabIndex = -1;
    row.style.setProperty('--ov-nav-level', String((entry.level ?? 1) - 1));
    if (entry.muted) row.classList.add('ov-nav-muted');

    const twisty = document.createElement('span');
    twisty.className = 'ov-nav-twisty';
    if (this.hasChildren(index)) {
      twisty.innerHTML = icons.chevronDown;
      twisty.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggle(index);
      });
    }
    const label = document.createElement('span');
    label.className = 'ov-nav-label';
    label.textContent = entry.label;
    row.title = entry.label;
    row.append(twisty);
    if (entry.decoration) row.append(entry.decoration);
    row.append(label);
    row.addEventListener('click', () => this.go(index));
    return row;
  }

  private hasChildren(index: number): boolean {
    const level = this.entries[index].level ?? 1;
    return (this.entries[index + 1]?.level ?? 1) > level;
  }

  private parent(index: number): number {
    const level = this.entries[index].level ?? 1;
    for (let i = index - 1; i >= 0; i--) {
      if ((this.entries[i].level ?? 1) < level) return i;
    }
    return -1;
  }

  private toggle(index: number, expand = this.collapsed.has(index)): void {
    if (!this.hasChildren(index)) return;
    if (expand) this.collapsed.delete(index);
    else this.collapsed.add(index);
    this.layout();
    this.shown = -2;
    this.update();
  }

  /** Hides the entries under collapsed ones. */
  private layout(): void {
    let hiddenBelow = Infinity;
    this.entries.forEach((entry, index) => {
      const level = entry.level ?? 1;
      if (level <= hiddenBelow) hiddenBelow = Infinity;
      this.rows[index].hidden = level > hiddenBelow;
      if (this.hasChildren(index)) {
        const collapsed = this.collapsed.has(index);
        this.rows[index].setAttribute('aria-expanded', String(!collapsed));
        const twisty = this.rows[index].querySelector('.ov-nav-twisty') as HTMLElement;
        twisty.title = collapsed ? this.strings.expand : this.strings.collapse;
        if (collapsed && !this.rows[index].hidden) hiddenBelow = Math.min(hiddenBelow, level);
      }
    });
  }

  private go(index: number): void {
    this.setTabStop(index);
    this.rows[index].focus();
    this.actions.select(index);
  }

  private setTabStop(index: number): void {
    this.rows.forEach((row, i) => {
      row.tabIndex = i === index ? 0 : -1;
      row.setAttribute('aria-selected', String(i === index));
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    const visible = this.rows.flatMap((row, index) => (row.hidden ? [] : [index]));
    const focused = this.rows.indexOf(document.activeElement as HTMLElement);
    const at = visible.indexOf(focused);
    if (focused < 0) return;
    let target: number | undefined;
    switch (event.key) {
      case 'ArrowDown':
        target = visible[Math.min(at + 1, visible.length - 1)];
        break;
      case 'ArrowUp':
        target = visible[Math.max(at - 1, 0)];
        break;
      case 'Home':
        target = visible[0];
        break;
      case 'End':
        target = visible[visible.length - 1];
        break;
      case 'ArrowRight':
        if (this.collapsed.has(focused)) this.toggle(focused, true);
        else if (this.hasChildren(focused)) target = focused + 1;
        break;
      case 'ArrowLeft':
        if (this.hasChildren(focused) && !this.collapsed.has(focused)) this.toggle(focused, false);
        else if (this.parent(focused) >= 0) target = this.parent(focused);
        break;
      case 'Enter':
      case ' ':
        target = focused;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target !== undefined) this.go(target);
  }
}

import type { ViewerStrings } from '../../shared/protocol';
import { icons } from '../icons';

export interface SheetTab {
  /** The sheet's index in the workbook, handed back when it is chosen. */
  index: number;
  name: string;
  /** CSS color of the tab's underline. */
  color?: string;
  /** When comparing: `added` or `removed`, the kind of changes this side shows. */
  change?: string;
}

export interface SheetTabActions {
  select(index: number): void;
  /** Lists every sheet to pick one from. */
  pickFromList(): void;
}

/** Wheel and button scrolling leave this much of the tabs at an edge in view. */
const EDGE = 48;

/** Width of a faded edge; the selected tab is kept clear of it. */
const FADE = 24;

/**
 * The sheet tabs under the grid. When they don't all fit, buttons on the left scroll them or
 * list every sheet, the mouse wheel scrolls them, and a faded edge shows there are more.
 */
export class SheetTabs {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly overflow: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly forward: HTMLButtonElement;
  private readonly resize: ResizeObserver;
  private frame = 0;
  private tabs: readonly SheetTab[] = [];
  private selected = -1;
  /** Where a button scroll is headed while it runs, so quick clicks add up. */
  private heading: number | undefined;

  constructor(
    strings: ViewerStrings,
    private readonly actions: SheetTabActions,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'ov-sheet-bar';

    this.overflow = document.createElement('div');
    this.overflow.className = 'ov-sheet-nav';
    this.overflow.hidden = true;
    this.back = this.button(strings.scrollSheetsLeft, icons.chevronLeft, () => this.page(-1));
    this.forward = this.button(strings.scrollSheetsRight, icons.chevronRight, () => this.page(1));
    const all = this.button(strings.allSheets, icons.list, () => actions.pickFromList());
    this.overflow.append(all, this.back, this.forward);

    this.list = document.createElement('div');
    this.list.className = 'ov-sheet-tabs';
    this.list.setAttribute('role', 'tablist');
    this.list.setAttribute('aria-label', strings.sheets);
    this.list.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.list.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.list.addEventListener('scroll', () => this.schedule(false), { passive: true });
    this.list.addEventListener('scrollend', () => {
      this.heading = undefined;
      this.update();
    });

    this.element.append(this.overflow, this.list);
    // The status next to the tabs grows and shrinks with the selection; the tab of the sheet
    // on screen stays in view.
    this.resize = new ResizeObserver(() => this.schedule(true));
    this.resize.observe(this.element);
    this.resize.observe(this.list);
  }

  render(tabs: readonly SheetTab[], selected: number): void {
    this.tabs = tabs;
    this.selected = selected;
    this.list.replaceChildren(
      ...tabs.map((sheet) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'ov-sheet-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(sheet.index === selected));
        tab.textContent = sheet.name;
        tab.title = sheet.name;
        if (sheet.color) {
          tab.style.setProperty('--tab-color', sheet.color);
          tab.classList.add('ov-sheet-tab-colored');
        }
        if (sheet.change) tab.dataset.change = sheet.change;
        // One tab stop for the whole list; arrow keys move between tabs.
        tab.tabIndex = sheet.index === selected ? 0 : -1;
        tab.addEventListener('click', () => this.actions.select(sheet.index));
        return tab;
      }),
    );
    this.update();
    this.reveal();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
  }

  private button(label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ov-icon-button';
    button.innerHTML = icon;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
    return button;
  }

  private selectedTab(): HTMLElement | null {
    return this.list.querySelector<HTMLElement>('[aria-selected="true"]');
  }

  private schedule(reveal: boolean): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.update();
      if (reveal) this.reveal();
    });
  }

  /** Scrolls the selected tab into view, clear of the faded edges. */
  private reveal(): void {
    const tab = this.selectedTab();
    if (!tab) return;
    const list = this.list.getBoundingClientRect();
    const { left, right } = tab.getBoundingClientRect();
    const before = this.list.scrollLeft > 0 ? FADE : 0;
    const after = this.list.scrollLeft < this.list.scrollWidth - this.list.clientWidth ? FADE : 0;
    if (left < list.left + before) this.list.scrollLeft -= list.left + FADE - left;
    else if (right > list.right - after) this.list.scrollLeft += right - (list.right - FADE);
  }

  /** Shows the overflow buttons and faded edges only while some tabs are out of view. */
  private update(): void {
    const { list, overflow } = this;
    // Measured against the room the buttons would leave too, so showing them can't flip it.
    const room = list.clientWidth + (overflow.hidden ? 0 : overflow.offsetWidth);
    const overflowing = list.scrollWidth > room + 1;
    overflow.hidden = !overflowing;
    const end = list.scrollWidth - list.clientWidth;
    const at = this.heading ?? list.scrollLeft;
    this.back.disabled = !(overflowing && at > 1);
    this.forward.disabled = !(overflowing && at < end - 1);
    list.toggleAttribute('data-more-before', overflowing && list.scrollLeft > 1);
    list.toggleAttribute('data-more-after', overflowing && list.scrollLeft < end - 1);
  }

  /** Scrolls by a page of tabs, keeping a little of the last page in view to read on from. */
  private page(direction: 1 | -1): void {
    const { list } = this;
    const step = direction * Math.max(list.clientWidth - EDGE, EDGE);
    const end = list.scrollWidth - list.clientWidth;
    this.heading = Math.max(0, Math.min(end, (this.heading ?? list.scrollLeft) + step));
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ left: this.heading, behavior: reduce ? 'auto' : 'smooth' });
    this.update();
  }

  /** The wheel scrolls the tabs sideways, as it does VS Code's own tabs. */
  private onWheel(event: WheelEvent): void {
    // Ctrl+wheel zooms.
    if (event.ctrlKey || event.metaKey) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0 || this.list.scrollWidth <= this.list.clientWidth) return;
    event.preventDefault();
    this.heading = undefined;
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? this.list.clientWidth
          : 1;
    this.list.scrollLeft += delta * unit;
  }

  /** Arrow keys, Home and End move between sheet tabs, as in any tab list. */
  private onKeyDown(event: KeyboardEvent): void {
    const position = this.tabs.findIndex((tab) => tab.index === this.selected);
    const target = (
      {
        ArrowLeft: position - 1,
        ArrowRight: position + 1,
        Home: 0,
        End: this.tabs.length - 1,
      } as Record<string, number>
    )[event.key];
    if (target === undefined || target < 0 || target >= this.tabs.length) return;
    event.preventDefault();
    // Selecting renders the tabs again right away, before the sheet itself loads.
    this.actions.select(this.tabs[target].index);
    this.selectedTab()?.focus();
  }
}

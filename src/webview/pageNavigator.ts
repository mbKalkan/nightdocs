import type { RenderContext } from './renderers/types';

/** Canvas left visible above a page that Page Up/Down brings to the top. */
const MARGIN = 12;

/**
 * Tracks which page or slide is in view for the status bar, and makes Page Up/Down step from
 * one to the next while a whole one fits in the window.
 */
export class PageNavigator {
  private readonly status: HTMLElement;
  private readonly cleanup: (() => void)[] = [];
  private shown = -1;

  /** `position` reads like `Slide {0} of {1}`. */
  constructor(
    private readonly context: RenderContext,
    private readonly frames: readonly HTMLElement[],
    private readonly position: string,
  ) {
    const { viewport, footer } = context;
    this.status = document.createElement('div');
    this.status.className = 'ov-status';
    this.status.setAttribute('aria-live', 'polite');
    footer.replaceChildren(this.status);
    footer.hidden = frames.length === 0;

    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.update());
    };
    const onKeyDown = (event: KeyboardEvent) => this.onKeyDown(event);
    const resize = new ResizeObserver(onScroll);
    resize.observe(viewport);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    this.cleanup.push(() => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      viewport.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKeyDown);
    });
    this.update();
  }

  /** The page or slide in view (0-based). */
  get current(): number {
    return Math.max(0, this.shown);
  }

  /** Scrolls so that page or slide `index` (0-based) is at the top. */
  goTo(index: number): void {
    const tops = this.tops();
    if (index >= 0 && index < tops.length) {
      this.context.viewport.scrollTop = tops[index] - MARGIN;
    }
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
  }

  /** Page tops in the viewport's scroll coordinates, which include the zoom. */
  private tops(): number[] {
    const { viewport } = this.context;
    const origin = viewport.getBoundingClientRect().top - viewport.scrollTop;
    return this.frames.map((frame) => frame.getBoundingClientRect().top - origin);
  }

  /**
   * The page at the top of the window, as PDF viewers count, so that going to a slide or a
   * heading shows its own number even when the next page is mostly in view.
   */
  private update(): void {
    const { viewport } = this.context;
    const line = viewport.scrollTop + 2 * MARGIN + 8;
    const tops = this.tops();
    let index = 0;
    while (index + 1 < tops.length && tops[index + 1] <= line) index++;
    if (index === this.shown || tops.length === 0) return;
    this.shown = index;
    this.status.textContent = this.position
      .replace('{0}', String(index + 1))
      .replace('{1}', String(tops.length));
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'PageDown' && event.key !== 'PageUp') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof HTMLInputElement || event.defaultPrevented) return;
    const { viewport } = this.context;
    const pageHeight = this.frames[0]?.getBoundingClientRect().height ?? 0;
    // Zoomed in past the window height, paging scrolls by screens as usual.
    if (pageHeight + MARGIN > viewport.clientHeight) return;

    const stops = this.tops().map((top) => top - MARGIN);
    const position = viewport.scrollTop;
    // Down skips a page that is already about in place (the first one is, before any
    // scrolling); up first brings back the top of a page scrolled into.
    const target =
      event.key === 'PageDown'
        ? stops.find((stop) => stop > position + 2 * MARGIN)
        : [...stops].reverse().find((stop) => stop < position - 1);
    event.preventDefault();
    viewport.scrollTop = target ?? (event.key === 'PageDown' ? viewport.scrollHeight : 0);
  }
}

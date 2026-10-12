import type { ViewerStrings } from '../../shared/protocol';
import type { RenderContext } from '../renderers/types';

/** Canvas left visible above a slide that Page Up/Down brings to the top. */
const MARGIN = 12;

/**
 * Tracks which slide is in view for the status bar, and makes Page Up/Down step from slide
 * to slide while a whole slide fits in the window.
 */
export class SlideNavigator {
  private readonly status: HTMLElement;
  private readonly cleanup: (() => void)[] = [];
  private current = -1;

  constructor(
    private readonly context: RenderContext,
    private readonly frames: readonly HTMLElement[],
    private readonly strings: ViewerStrings,
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

  /** Scrolls so that slide `index` (0-based) is at the top. */
  goTo(index: number): void {
    const tops = this.tops();
    if (index >= 0 && index < tops.length) {
      this.context.viewport.scrollTop = tops[index] - MARGIN;
    }
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
  }

  /** Slide tops in the viewport's scroll coordinates, which include the zoom. */
  private tops(): number[] {
    const { viewport } = this.context;
    const origin = viewport.getBoundingClientRect().top - viewport.scrollTop;
    return this.frames.map((frame) => frame.getBoundingClientRect().top - origin);
  }

  /** The slide that crosses the middle of the window. */
  private update(): void {
    const { viewport } = this.context;
    const middle = viewport.scrollTop + viewport.clientHeight / 2;
    const tops = this.tops();
    let index = 0;
    while (index + 1 < tops.length && tops[index + 1] <= middle) index++;
    if (index === this.current || tops.length === 0) return;
    this.current = index;
    this.status.textContent = this.strings.slidePosition
      .replace('{0}', String(index + 1))
      .replace('{1}', String(tops.length));
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'PageDown' && event.key !== 'PageUp') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof HTMLInputElement || event.defaultPrevented) return;
    const { viewport } = this.context;
    const slideHeight = this.frames[0]?.getBoundingClientRect().height ?? 0;
    // Zoomed in past the window height, paging scrolls by screens as usual.
    if (slideHeight + MARGIN > viewport.clientHeight) return;

    const stops = this.tops().map((top) => top - MARGIN);
    const position = viewport.scrollTop;
    // Down skips a slide that is already about in place (the first one is, before any
    // scrolling); up first brings back the top of a slide scrolled into.
    const target =
      event.key === 'PageDown'
        ? stops.find((stop) => stop > position + 2 * MARGIN)
        : [...stops].reverse().find((stop) => stop < position - 1);
    event.preventDefault();
    viewport.scrollTop = target ?? (event.key === 'PageDown' ? viewport.scrollHeight : 0);
  }
}

/** Where a change is, in the viewport's scroll coordinates, and what it is. */
export interface OverviewMark {
  top: number;
  bottom: number;
  /** The original version had content here (left lane, red). */
  removed: boolean;
  /** The modified version has content here (right lane, green). */
  added: boolean;
}

/** A change shorter than this on the ruler is drawn this tall, so it can be seen and clicked. */
const MIN_MARK = 3;
/** How near a click has to be to a mark to go to that change. */
const HIT_SLOP = 4;

/**
 * The strip beside a comparison's scrollbar that shows where the changes are in the whole
 * document, as VS Code's diff editor does: removed content in the left lane, added in the right,
 * and the part in view as a slider. Clicking a change goes to it; clicking elsewhere or dragging
 * scrolls there.
 */
export class OverviewRuler {
  readonly element: HTMLElement;
  private readonly lanes: HTMLElement;
  private readonly slider: HTMLElement;
  private marks: OverviewMark[] = [];
  private frame = 0;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly viewport: HTMLElement,
    private readonly measure: () => OverviewMark[],
    /** Goes to change `index`, as the next/previous buttons would. */
    private readonly goTo: (index: number) => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'ov-overview';
    this.element.setAttribute('aria-hidden', 'true');
    this.lanes = document.createElement('div');
    this.lanes.className = 'ov-overview-lanes';
    this.slider = document.createElement('div');
    this.slider.className = 'ov-overview-slider';
    this.element.append(this.lanes, this.slider);

    const schedule = () => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.draw());
    };
    const onScroll = () => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.drawSlider());
    };
    // Content changes height as pictures load and the zoom or window size changes.
    const resize = new ResizeObserver(schedule);
    resize.observe(viewport);
    for (const child of viewport.children) resize.observe(child);
    resize.observe(this.element);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    this.element.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.cleanup.push(() => {
      cancelAnimationFrame(this.frame);
      resize.disconnect();
      viewport.removeEventListener('scroll', onScroll);
    });
    viewport.after(this.element);
    this.draw();
  }

  dispose(): void {
    this.cleanup.forEach((fn) => fn());
    this.element.remove();
  }

  /** Lays the marks out again, for when the content moved. */
  draw(): void {
    this.marks = this.measure();
    const scale = this.scale();
    const pieces: HTMLElement[] = [];
    for (const mark of this.marks) {
      const top = mark.top * scale;
      const height = Math.max(MIN_MARK, (mark.bottom - mark.top) * scale);
      for (const lane of ['removed', 'added'] as const) {
        if (!mark[lane]) continue;
        const piece = document.createElement('div');
        piece.className = `ov-overview-mark ov-overview-${lane}`;
        piece.style.top = `${Math.min(top, this.element.clientHeight - height)}px`;
        piece.style.height = `${height}px`;
        pieces.push(piece);
      }
    }
    this.lanes.replaceChildren(...pieces);
    this.drawSlider();
  }

  private drawSlider(): void {
    const { scrollTop, clientHeight, scrollHeight } = this.viewport;
    const scale = this.scale();
    this.slider.hidden = scrollHeight <= clientHeight;
    this.slider.style.top = `${scrollTop * scale}px`;
    this.slider.style.height = `${clientHeight * scale}px`;
  }

  /** Ruler pixels per pixel of content. */
  private scale(): number {
    const { scrollHeight } = this.viewport;
    return scrollHeight > 0 ? this.element.clientHeight / scrollHeight : 0;
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const scale = this.scale();
    if (scale <= 0) return;
    const bounds = this.element.getBoundingClientRect();
    const y = event.clientY - bounds.top;
    const slider = this.slider.getBoundingClientRect();
    const onSlider = event.clientY >= slider.top && event.clientY <= slider.bottom;

    if (!onSlider) {
      const hit = this.marks.findIndex(
        (mark) =>
          y >= mark.top * scale - HIT_SLOP &&
          y <= Math.max(mark.top * scale + MIN_MARK, mark.bottom * scale) + HIT_SLOP,
      );
      if (hit >= 0) {
        this.goTo(hit);
        return;
      }
      this.viewport.scrollTop = y / scale - this.viewport.clientHeight / 2;
    }

    // Dragging moves the view along, as dragging a scrollbar does.
    const startY = event.clientY;
    const startTop = this.viewport.scrollTop;
    const onMove = (move: PointerEvent) => {
      this.viewport.scrollTop = startTop + (move.clientY - startY) / scale;
    };
    const onUp = () => {
      this.element.releasePointerCapture(event.pointerId);
      this.element.removeEventListener('pointermove', onMove);
      this.element.removeEventListener('pointerup', onUp);
      this.element.removeEventListener('pointercancel', onUp);
    };
    this.element.setPointerCapture(event.pointerId);
    this.element.addEventListener('pointermove', onMove);
    this.element.addEventListener('pointerup', onUp);
    this.element.addEventListener('pointercancel', onUp);
  }
}

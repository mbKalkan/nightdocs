import { clampZoom, fitWidthZoom, nextZoomIn, nextZoomOut } from '../shared/zoom';

export interface ZoomTarget {
  viewport: HTMLElement;
  content: HTMLElement;
  onChange(zoom: number, fixed: number | null): void;
}

/**
 * Scales the content with CSS `zoom` (which, unlike transforms, also scales layout,
 * so scrollbars stay correct). Without a fixed zoom, pages fit the window width.
 */
export class ZoomController {
  private fixed: number | null;
  private naturalWidth = 0;
  private current = 1;

  constructor(
    private readonly target: ZoomTarget,
    initial: number | null,
  ) {
    this.fixed = initial;
    new ResizeObserver(() => {
      if (this.fixed === null) {
        this.apply(this.fitZoom());
      }
    }).observe(target.viewport);
  }

  get zoom(): number {
    return this.current;
  }

  setNaturalWidth(width: number): void {
    this.naturalWidth = width;
    this.apply(this.fixed ?? this.fitZoom());
  }

  zoomIn(anchor?: { x: number; y: number }): void {
    this.setFixed(nextZoomIn(this.current), anchor);
  }

  zoomOut(anchor?: { x: number; y: number }): void {
    this.setFixed(nextZoomOut(this.current), anchor);
  }

  /** Continuous zoom for pinch gestures and Ctrl+wheel. */
  zoomBy(factor: number, anchor: { x: number; y: number }): void {
    this.setFixed(clampZoom(this.current * factor), anchor);
  }

  reset(): void {
    this.fixed = null;
    this.apply(this.fitZoom());
  }

  private setFixed(zoom: number, anchor?: { x: number; y: number }): void {
    this.fixed = zoom;
    this.apply(zoom, anchor);
  }

  private fitZoom(): number {
    return fitWidthZoom(this.naturalWidth, this.target.viewport.clientWidth);
  }

  /** Applies a zoom while keeping the point under `anchor` (default: top center) in place. */
  private apply(zoom: number, anchor?: { x: number; y: number }): void {
    const { viewport, content } = this.target;
    const previous = this.current;
    const x = anchor?.x ?? viewport.clientWidth / 2;
    const y = anchor?.y ?? 0;
    const pointX = (viewport.scrollLeft + x) / previous;
    const pointY = (viewport.scrollTop + y) / previous;

    this.current = zoom;
    content.style.zoom = String(zoom);
    viewport.scrollLeft = pointX * zoom - x;
    viewport.scrollTop = pointY * zoom - y;
    this.target.onChange(zoom, this.fixed);
  }
}

/** Zoom stops, as scale factors. Mirrors the steps people know from Office and browsers. */
export const ZOOM_STEPS: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
];

export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function nextZoomIn(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? MAX_ZOOM;
}

export function nextZoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001) ?? MIN_ZOOM;
}

/**
 * Zoom that fits a page into the available width, never enlarging beyond 100%
 * so short documents don't look blown up on wide screens.
 */
export function fitWidthZoom(pageWidth: number, availableWidth: number): number {
  if (pageWidth <= 0 || availableWidth <= 0) {
    return 1;
  }
  return clampZoom(Math.min(1, availableWidth / pageWidth));
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

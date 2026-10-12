import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitWidthZoom,
  formatZoom,
  nextZoomIn,
  nextZoomOut,
} from '../../src/shared/zoom';

describe('zoom steps', () => {
  it('moves to the next stop', () => {
    expect(nextZoomIn(1)).toBe(1.1);
    expect(nextZoomOut(1)).toBe(0.9);
  });

  it('snaps in-between values to the nearest stop in the zoom direction', () => {
    expect(nextZoomIn(1.03)).toBe(1.1);
    expect(nextZoomOut(1.03)).toBe(1);
  });

  it('stays within bounds', () => {
    expect(nextZoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(nextZoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });
});

describe('fitWidthZoom', () => {
  it('shrinks wide pages to fit', () => {
    expect(fitWidthZoom(1000, 500)).toBe(0.5);
  });

  it('never enlarges beyond 100%', () => {
    expect(fitWidthZoom(800, 1600)).toBe(1);
  });

  it('falls back to 100% before layout is known', () => {
    expect(fitWidthZoom(0, 500)).toBe(1);
    expect(fitWidthZoom(800, 0)).toBe(1);
  });
});

describe('formatZoom', () => {
  it('formats as a rounded percentage', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(0.333)).toBe('33%');
  });
});

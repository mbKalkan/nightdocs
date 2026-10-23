import type { Page } from '@playwright/test';

/**
 * Lowest WCAG contrast between any text and the opaque background behind it, measured from
 * computed styles in the page.
 */
export const lowestTextContrast = (page: Page) =>
  page.evaluate(() => {
    const parse = (value: string) => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(value);
      if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
      // What color-mix() computes to.
      const c = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(value);
      return c
        ? { rgb: [+c[1] * 255, +c[2] * 255, +c[3] * 255], a: c[4] === undefined ? 1 : +c[4] }
        : undefined;
    };
    const luminance = ([r, g, b]: number[]) => {
      const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const backgroundOf = (el: Element | null): number[] => {
      for (let node = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg.a >= 0.5) return bg.rgb;
      }
      return [255, 255, 255];
    };
    let lowest = Infinity;
    const walker = document.createTreeWalker(
      document.querySelector('.ov-content') as Node,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || el.tagName === 'STYLE' || !node.textContent?.trim()) continue;
      const fg = parse(getComputedStyle(el).color);
      if (!fg) continue;
      const [a, b] = [luminance(fg.rgb), luminance(backgroundOf(el))].sort((x, y) => y - x);
      lowest = Math.min(lowest, (a + 0.05) / (b + 0.05));
    }
    return lowest;
  });

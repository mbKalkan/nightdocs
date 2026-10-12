import { describe, expect, it } from 'vitest';
import {
  adaptBackground,
  adaptBorder,
  adaptForeground,
  contrastRatio,
  ensureContrast,
  formatCssColor,
  parseCssColor,
  type DarkPalette,
  type Rgb,
} from '../../src/shared/color';

const hex = (value: string) => parseCssColor(value) as Rgb;
const toHex = ({ r, g, b }: Rgb) =>
  '#' +
  [r, g, b]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

// VS Code Dark Modern
const palette: DarkPalette = { background: hex('#1f1f1f'), foreground: hex('#cccccc') };

/** Hue angle in degrees, from the RGB color wheel; good enough to compare hues. */
function hue({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const hueDistance = (x: number, y: number) => Math.min(Math.abs(x - y), 360 - Math.abs(x - y));

describe('parseCssColor / formatCssColor', () => {
  it('reads the formats getComputedStyle returns', () => {
    expect(parseCssColor('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor('rgb(0 128 255 / 50%)')?.a).toBe(0.5);
    expect(parseCssColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseCssColor('currentcolor')).toBeUndefined();
  });

  it('round-trips', () => {
    expect(formatCssColor(hex('#1f4e79'))).toBe('rgb(31, 78, 121)');
    expect(formatCssColor({ r: 1, g: 1, b: 1, a: 0.5 })).toBe('rgba(255, 255, 255, 0.5)');
  });
});

describe('adaptBackground', () => {
  it('turns white paper into the editor background', () => {
    expect(toHex(adaptBackground(hex('#ffffff'), palette))).toBe('#1f1f1f');
  });

  it('turns light tints into dark tints of the same hue', () => {
    const tint = hex('#deeaf6'); // light blue table row
    const adapted = adaptBackground(tint, palette);
    expect(contrastRatio(adapted, palette.background)).toBeLessThan(1.6);
    expect(hueDistance(hue(adapted), hue(tint))).toBeLessThan(20);
  });

  it('keeps a highlight recognizable', () => {
    const adapted = adaptBackground(hex('#ffff00'), palette);
    expect(contrastRatio(adapted, palette.background)).toBeGreaterThan(2);
    expect(hueDistance(hue(adapted), 60)).toBeLessThan(15);
    expect(adapted.r).toBeGreaterThan(adapted.b + 0.1);
  });

  it('leaves dark backgrounds alone', () => {
    const header = hex('#1f4e79');
    expect(adaptBackground(header, palette)).toEqual(header);
  });
});

describe('adaptForeground', () => {
  it('turns black text into the editor foreground', () => {
    expect(toHex(adaptForeground(hex('#000000'), palette.background, palette))).toBe('#cccccc');
  });

  it('keeps hue for colored text', () => {
    for (const color of ['#c00000', '#2e74b5', '#548235', '#c55a11', '#0563c1']) {
      const adapted = adaptForeground(hex(color), palette.background, palette);
      expect(hueDistance(hue(adapted), hue(hex(color))), color).toBeLessThan(20);
    }
  });

  it('always reaches AA contrast on the background it sits on', () => {
    const backgrounds = ['#ffffff', '#deeaf6', '#ffff00', '#1f4e79', '#7f7f7f'].map((c) =>
      adaptBackground(hex(c), palette),
    );
    const texts = ['#000000', '#7f7f7f', '#c00000', '#0563c1', '#ffffff', '#ffc000', '#1f4e79'];
    for (const background of backgrounds) {
      for (const text of texts) {
        const adapted = adaptForeground(hex(text), background, palette);
        expect(
          contrastRatio(adapted, background),
          `${text} on ${toHex(background)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('reaches AAA contrast in high-contrast themes', () => {
    const highContrast: DarkPalette = {
      background: hex('#000000'),
      foreground: hex('#ffffff'),
      highContrast: true,
    };
    const page = adaptBackground(hex('#ffffff'), highContrast);
    for (const text of ['#7f7f7f', '#c00000', '#0563c1', '#2f5496']) {
      const adapted = adaptForeground(hex(text), page, highContrast);
      expect(contrastRatio(adapted, page), text).toBeGreaterThanOrEqual(7);
    }
  });

  it('keeps white text on dark fills', () => {
    const header = hex('#1f4e79');
    expect(toHex(adaptForeground(hex('#ffffff'), header, palette))).toBe('#ffffff');
  });

  it('preserves transparency', () => {
    expect(adaptForeground({ r: 0, g: 0, b: 0, a: 0.5 }, palette.background, palette).a).toBe(0.5);
  });
});

describe('adaptBorder', () => {
  it('draws black borders as a muted line between page and text', () => {
    const border = adaptBorder(hex('#000000'), palette);
    const page = palette.background;
    expect(contrastRatio(border, page)).toBeGreaterThan(2);
    expect(contrastRatio(border, page)).toBeLessThan(contrastRatio(palette.foreground, page));
  });
});

describe('ensureContrast', () => {
  it('darkens text on light backgrounds', () => {
    const adapted = ensureContrast(hex('#aaaaaa'), hex('#ffffff'), 4.5);
    expect(contrastRatio(adapted, hex('#ffffff'))).toBeGreaterThanOrEqual(4.5);
  });
});

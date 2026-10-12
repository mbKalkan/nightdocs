import { elements, firstElement } from './xml';

/** Excel's legacy indexed palette (indexes 0–63). */
const INDEXED = [
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '800000',
  '008000',
  '000080',
  '808000',
  '800080',
  '008080',
  'C0C0C0',
  '808080',
  '9999FF',
  '993366',
  'FFFFCC',
  'CCFFFF',
  '660066',
  'FF8080',
  '0066CC',
  'CCCCFF',
  '000080',
  'FF00FF',
  'FFFF00',
  '00FFFF',
  '800080',
  '800000',
  '008080',
  '0000FF',
  '00CCFF',
  'CCFFFF',
  'CCFFCC',
  'FFFF99',
  '99CCFF',
  'FF99CC',
  'CC99FF',
  'FFCC99',
  '3366FF',
  '33CCCC',
  '99CC00',
  'FFCC00',
  'FF9900',
  'FF6600',
  '666699',
  '969696',
  '003366',
  '339966',
  '003300',
  '333300',
  '993300',
  '993366',
  '333399',
  '333333',
];

/** Office default theme colors, used when a workbook has no theme part. */
const DEFAULT_THEME = [
  'FFFFFF',
  '000000',
  'E7E6E6',
  '44546A',
  '4472C4',
  'ED7D31',
  'A5A5A5',
  'FFC000',
  '5B9BD5',
  '70AD47',
  '0563C1',
  '954F72',
];

/**
 * Reads the theme color scheme in the order Excel's `theme="n"` indexes use:
 * lt1, dk1, lt2, dk2, accent1–6, hlink, folHlink (the first two pairs are swapped
 * relative to the order they appear in the file).
 */
export function readThemeColors(themeXml: string | undefined): string[] {
  const scheme = themeXml && firstElement(themeXml, 'clrScheme');
  if (!scheme) {
    return DEFAULT_THEME;
  }
  const names = [
    'dk1',
    'lt1',
    'dk2',
    'lt2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hlink',
    'folHlink',
  ];
  const colors = names.map((name, i) => {
    const entry = firstElement(scheme.body, name);
    const value =
      entry && (firstElement(entry.body, 'srgbClr') ?? firstElement(entry.body, 'sysClr'));
    return value?.attrs.val && value.attrs.val.length === 6
      ? value.attrs.val
      : (value?.attrs.lastClr ?? DEFAULT_THEME[[1, 0, 3, 2][i] ?? i]);
  });
  [colors[0], colors[1]] = [colors[1], colors[0]];
  [colors[2], colors[3]] = [colors[3], colors[2]];
  return colors;
}

/** Resolves a SpreadsheetML color element's attributes to `#rrggbb`, or undefined for automatic. */
export function resolveColor(
  attrs: Record<string, string> | undefined,
  theme: string[],
): string | undefined {
  if (!attrs || attrs.auto === '1') {
    return undefined;
  }
  let hex: string | undefined;
  if (attrs.rgb) {
    hex = attrs.rgb.length === 8 ? attrs.rgb.slice(2) : attrs.rgb;
  } else if (attrs.theme !== undefined) {
    hex = theme[parseInt(attrs.theme, 10)];
  } else if (attrs.indexed !== undefined) {
    // 64 and above are the system foreground/background: treat as automatic.
    hex = INDEXED[parseInt(attrs.indexed, 10)];
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) {
    return undefined;
  }
  const tint = attrs.tint ? parseFloat(attrs.tint) : 0;
  return `#${(tint ? applyTint(hex, tint) : hex).toLowerCase()}`;
}

/** Excel's tint: scales HLS lightness towards black (negative) or white (positive). */
function applyTint(hex: string, tint: number): string {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  const d = max - min;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    const u = (t + 1) % 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channels = s === 0 ? [l, l, l] : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  return channels
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
}

export function firstColor(xml: string, theme: string[]): string | undefined {
  for (const color of elements(xml, 'color')) {
    return resolveColor(color.attrs, theme);
  }
  return undefined;
}

// Color math for showing documents in dark themes: OKLab lightness remapping that keeps
// hues, with WCAG contrast checks for text.

/** sRGB color with channels and alpha in 0..1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Lab {
  l: number;
  a: number;
  b: number;
}

export interface DarkPalette {
  /** What white page areas become, usually the editor background. */
  background: Rgb;
  /** What black text becomes, usually the editor foreground. */
  foreground: Rgb;
}

const MIN_TEXT_CONTRAST = 4.5;
/** Below this OKLab chroma a color counts as gray and takes the theme's tint instead. */
const NEUTRAL_CHROMA = 0.01;
/**
 * Saturated light fills such as highlights would sink into the page if darkened like paper;
 * they keep extra lightness in proportion to their chroma (OKLab units, capped).
 */
const CHROMA_LIFT = 1;
const MAX_LIFT = 0.22;
/** Borders end up between the page and text lightness so tables don't look heavy. */
const BORDER_WEIGHT = 0.55;

export function parseCssColor(value: string): Rgb | undefined {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((d) => d + d)
            .join('')
        : hex[1];
    const channel = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
    return { r: channel(0), g: channel(2), b: channel(4), a: 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    text,
  );
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : parseAlpha(rgb[4]);
    return { r: +rgb[1] / 255, g: +rgb[2] / 255, b: +rgb[3] / 255, a: alpha };
  }
  return undefined;
}

function parseAlpha(value: string): number {
  return value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value);
}

export function formatCssColor({ r, g, b, a }: Rgb): string {
  const channel = (c: number) => Math.round(clamp(c, 0, 1) * 255);
  const rgb = `${channel(r)}, ${channel(g)}, ${channel(b)}`;
  return a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${Math.round(a * 1000) / 1000})`;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(x: Rgb, y: Rgb): number {
  const [light, dark] = [relativeLuminance(x), relativeLuminance(y)].sort((p, q) => q - p);
  return (light + 0.05) / (dark + 0.05);
}

/** Light backgrounds become dark ones of the same hue; dark backgrounds are kept. */
export function adaptBackground(color: Rgb, palette: DarkPalette): Rgb {
  const lab = toLab(color);
  if (lab.l < 0.5) {
    return color;
  }
  const page = toLab(palette.background);
  // 0 for white, 1 for mid lightness.
  const t = clamp((1 - lab.l) / 0.5, 0, 1);
  const lift = Math.min(MAX_LIFT, CHROMA_LIFT * Math.hypot(lab.a, lab.b));
  const l = Math.max(page.l + t * (0.5 - page.l), page.l + lift);
  return fromLabInGamut(withHue(lab, page, l, t), color.a);
}

/** Dark text becomes light text of the same hue, with at least AA contrast on `background`. */
export function adaptForeground(color: Rgb, background: Rgb, palette: DarkPalette): Rgb {
  const lab = toLab(color);
  let adapted = color;
  if (lab.l <= 0.5) {
    const text = toLab(palette.foreground);
    // 0 for black, 1 for mid lightness.
    const t = clamp(lab.l / 0.5, 0, 1);
    adapted = fromLabInGamut(withHue(lab, text, text.l + t * (0.5 - text.l), t), color.a);
  }
  return ensureContrast(adapted, background, MIN_TEXT_CONTRAST);
}

/** Like text, but settles between the page and text lightness. */
export function adaptBorder(color: Rgb, palette: DarkPalette): Rgb {
  const lab = toLab(color);
  if (lab.l > 0.5) {
    return color;
  }
  const page = toLab(palette.background);
  const text = toLab(palette.foreground);
  const target: Lab = {
    l: page.l + BORDER_WEIGHT * (text.l - page.l),
    a: page.a + BORDER_WEIGHT * (text.a - page.a),
    b: page.b + BORDER_WEIGHT * (text.b - page.b),
  };
  const t = clamp(lab.l / 0.5, 0, 1);
  return fromLabInGamut(withHue(lab, target, target.l + t * (0.5 - target.l), t), color.a);
}

/** Moves the lightness of `color` away from `background` until the contrast is reached. */
export function ensureContrast(color: Rgb, background: Rgb, minimum: number): Rgb {
  if (contrastRatio(color, background) >= minimum) {
    return color;
  }
  const lab = toLab(color);
  const lighten = relativeLuminance(background) < 0.18;
  let low = lab.l;
  let high = lighten ? 1 : 0;
  let best = quantize(fromLabInGamut({ ...lab, l: high }, color.a));
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    // Check the 8-bit color that will actually be rendered, not the exact one.
    const candidate = quantize(fromLabInGamut({ ...lab, l: mid }, color.a));
    if (contrastRatio(candidate, background) >= minimum) {
      best = candidate;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

/**
 * Keeps a chromatic color's hue and chroma at the new lightness. Grays take the theme's
 * tint, fading towards neutral as `t` approaches 1.
 */
function withHue(lab: Lab, theme: Lab, l: number, t: number): Lab {
  if (Math.hypot(lab.a, lab.b) < NEUTRAL_CHROMA) {
    return { l, a: theme.a * (1 - t), b: theme.b * (1 - t) };
  }
  return { l, a: lab.a, b: lab.b };
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function toLab(color: Rgb): Lab {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function labToLinear({ l, a, b }: Lab): [number, number, number] {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

/** Converts back to sRGB, reducing chroma until the color fits the sRGB gamut. */
function fromLabInGamut(target: Lab, alpha: number): Rgb {
  const lab = { ...target, l: clamp(target.l, 0, 1) };
  const fits = (k: number) =>
    labToLinear({ l: lab.l, a: lab.a * k, b: lab.b * k }).every((c) => c >= -1e-4 && c <= 1 + 1e-4);
  let k = 1;
  if (!fits(1)) {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    k = low;
  }
  const linear = labToLinear({ l: lab.l, a: lab.a * k, b: lab.b * k });
  const [r, g, b] = linear.map((c) => toSrgb(clamp(c, 0, 1)));
  return { r, g, b, a: alpha };
}

function quantize({ r, g, b, a }: Rgb): Rgb {
  const q = (c: number) => Math.round(c * 255) / 255;
  return { r: q(r), g: q(g), b: q(b), a };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

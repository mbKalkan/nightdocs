import {
  adaptBackground,
  adaptBorder,
  adaptForeground,
  formatCssColor,
  parseCssColor,
  type DarkPalette,
  type Rgb,
} from '../../shared/color';
import { FORMAT_COLORS, type BorderSide, type CellStyle } from './model';

/** Colors of the grid itself (not the cell contents). */
export interface GridColors {
  sheet: string;
  text: string;
  gridLine: string;
  headerBackground: string;
  headerText: string;
  headerLine: string;
}

const EXCEL_COLORS: GridColors = {
  sheet: '#ffffff',
  text: '#000000',
  gridLine: '#e1e1e1',
  headerBackground: '#f5f5f5',
  headerText: '#444444',
  headerLine: '#d4d4d4',
};

const BORDER_WIDTHS: Record<string, string> = {
  thin: '1px solid',
  hair: '1px solid',
  medium: '2px solid',
  thick: '3px solid',
  double: '3px double',
  dashed: '1px dashed',
  mediumDashed: '2px dashed',
  dotted: '1px dotted',
  dashDot: '1px dashed',
  mediumDashDot: '2px dashed',
  dashDotDot: '1px dotted',
  mediumDashDotDot: '2px dotted',
  slantDashDot: '2px dashed',
};

export function gridColors(palette: DarkPalette | undefined): GridColors {
  if (!palette) {
    return EXCEL_COLORS;
  }
  const mix = (amount: number) =>
    formatCssColor(blend(palette.background, palette.foreground, amount));
  return {
    sheet: formatCssColor(palette.background),
    text: formatCssColor(palette.foreground),
    gridLine: mix(0.13),
    headerBackground: mix(0.06),
    headerText: mix(0.75),
    headerLine: mix(0.2),
  };
}

/** Resolves cell colors for display, adapting them when a dark palette is given. */
export class CellColors {
  private readonly sheet: Rgb;
  private readonly cache = new Map<string, string>();

  constructor(private readonly palette: DarkPalette | undefined) {
    this.sheet = palette?.background ?? { r: 1, g: 1, b: 1, a: 1 };
  }

  fill(color: string | undefined): string | undefined {
    if (!color || !this.palette) return color;
    return this.memo(`f${color}`, () => formatCssColor(adaptBackground(rgb(color), this.palette!)));
  }

  text(color: string | undefined, fill: string | undefined): string | undefined {
    if (!this.palette) return color;
    if (!color && !fill) return undefined;
    return this.memo(`t${color}${fill}`, () => {
      const surface = fill ? adaptBackground(rgb(fill), this.palette!) : this.sheet;
      const source = color ? rgb(color) : { r: 0, g: 0, b: 0, a: 1 };
      return formatCssColor(adaptForeground(source, surface, this.palette!));
    });
  }

  border(color: string | undefined): string {
    if (!this.palette) return color ?? '#000000';
    return this.memo(`b${color}`, () =>
      formatCssColor(adaptBorder(color ? rgb(color) : { r: 0, g: 0, b: 0, a: 1 }, this.palette!)),
    );
  }

  /** Color forced by a number format such as `[Red]`. */
  formatColor(index: number, fill: string | undefined): string | undefined {
    return index > 0 ? this.text(FORMAT_COLORS[index], fill) : undefined;
  }

  private memo(key: string, compute: () => string): string {
    let value = this.cache.get(key);
    if (value === undefined) {
      value = compute();
      this.cache.set(key, value);
    }
    return value;
  }
}

/** One CSS class per cell style, scoped under `scope`. */
export function buildStyleSheet(styles: CellStyle[], colors: CellColors, scope: string): string {
  const rules = styles.map((style, index) => {
    const declarations = [`font-family:${fontStack(style.fontName)}`, `font-size:${style.size}pt`];
    if (style.bold) declarations.push('font-weight:700');
    if (style.italic) declarations.push('font-style:italic');
    const decorations = [
      style.underline !== 'none' ? 'underline' : '',
      style.strike ? 'line-through' : '',
    ].filter(Boolean);
    if (decorations.length) declarations.push(`text-decoration:${decorations.join(' ')}`);
    if (style.underline === 'double') declarations.push('text-decoration-style:double');
    const color = colors.text(style.color, style.fill);
    if (color) declarations.push(`color:${color}`);
    const fill = colors.fill(style.fill);
    if (fill) declarations.push(`background:${fill}`);
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const border = style.border[side];
      if (border) declarations.push(`border-${side}:${borderCss(border, colors)}`);
    }
    if (style.indent) declarations.push(`padding-left:${3 + style.indent * 9}px`);
    return `${scope} .s${index}{${declarations.join(';')}}`;
  });
  return rules.join('\n');
}

export function fontStack(name: string): string {
  const safe = name.replace(/["\\]/g, '');
  return `"${safe}", "Aptos", "Calibri", "Carlito", "Segoe UI", Arial, sans-serif`;
}

function borderCss(border: BorderSide, colors: CellColors): string {
  return `${BORDER_WIDTHS[border.style] ?? '1px solid'} ${colors.border(border.color)}`;
}

function rgb(hex: string): Rgb {
  return parseCssColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
}

function blend(from: Rgb, to: Rgb, amount: number): Rgb {
  const mix = (a: number, b: number) => a + (b - a) * amount;
  return { r: mix(from.r, to.r), g: mix(from.g, to.g), b: mix(from.b, to.b), a: 1 };
}

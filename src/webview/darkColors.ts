import {
  adaptBackground,
  adaptBorder,
  adaptForeground,
  formatCssColor,
  parseCssColor,
  type DarkPalette,
  type Rgb,
} from '../shared/color';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Pictures keep their original colors; style elements have nothing to adapt. */
const SKIPPED_TAGS = new Set(['img', 'image', 'style', 'script']);

/** Marks content that must keep its colors, such as chart legend keys matching the chart. */
export const KEEP_COLORS_ATTRIBUTE = 'data-keep-colors';

/** True when VS Code uses a dark or dark high-contrast theme. */
export function isDarkTheme(): boolean {
  const kind = document.body.dataset.vscodeThemeKind;
  if (kind) {
    return kind === 'vscode-dark' || kind === 'vscode-high-contrast';
  }
  const classes = document.body.classList;
  return (
    classes.contains('vscode-dark') ||
    (classes.contains('vscode-high-contrast') && !classes.contains('vscode-high-contrast-light'))
  );
}

/** True for both the dark and the light high-contrast theme. */
export function isHighContrastTheme(): boolean {
  const kind = document.body.dataset.vscodeThemeKind;
  return kind
    ? kind.startsWith('vscode-high-contrast')
    : document.body.classList.contains('vscode-high-contrast');
}

/** Page and text colors taken from the current VS Code theme. */
export function readPalette(): DarkPalette | undefined {
  const styles = getComputedStyle(document.documentElement);
  const background = parseCssColor(styles.getPropertyValue('--vscode-editor-background'));
  const foreground = parseCssColor(styles.getPropertyValue('--vscode-editor-foreground'));
  return background && foreground
    ? { background, foreground, highContrast: isHighContrastTheme() }
    : undefined;
}

interface ColorRead {
  color: string;
  background: string;
  borders: string[];
  fill: string;
  stroke: string;
}

/**
 * Rewrites the colors of rendered document content (the descendants of `roots`) for a dark
 * theme: light backgrounds become dark, dark text becomes light, hues are kept and text
 * keeps AA contrast. Images are left untouched. Reads all computed styles first, then
 * writes, so the browser recalculates styles once.
 */
export function adaptDocumentColors(
  roots: HTMLElement | readonly HTMLElement[],
  palette: DarkPalette,
): void {
  const elements = (roots instanceof HTMLElement ? [roots] : roots)
    .flatMap((root) => Array.from(root.querySelectorAll<HTMLElement | SVGElement>('*')))
    .filter(
      (el) =>
        !SKIPPED_TAGS.has(el.tagName.toLowerCase()) && !el.closest(`[${KEEP_COLORS_ATTRIBUTE}]`),
    );
  const reads: ColorRead[] = elements.map((el) => {
    const style = getComputedStyle(el);
    return {
      color: style.color,
      background: style.backgroundColor,
      borders: SIDES.map((side) =>
        style.getPropertyValue(`border-${side}-style`) !== 'none' &&
        parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0
          ? style.getPropertyValue(`border-${side}-color`)
          : '',
      ),
      fill: el instanceof SVGElement ? style.fill : '',
      stroke: el instanceof SVGElement ? style.stroke : '',
    };
  });

  // The adapted background each element's text is drawn on, for contrast checks.
  const surfaces = new Map<Element, Rgb>();
  elements.forEach((el, i) => {
    const read = reads[i];
    let surface = (el.parentElement && surfaces.get(el.parentElement)) || palette.background;

    const background = parseCssColor(read.background);
    if (background && background.a > 0) {
      const adapted = adaptBackground(background, palette);
      el.style.setProperty('background-color', formatCssColor(adapted), 'important');
      if (background.a >= 0.5) {
        surface = adapted;
      }
    }
    surfaces.set(el, surface);

    const color = parseCssColor(read.color);
    if (color && color.a > 0) {
      const adapted = adaptForeground(color, surface, palette);
      el.style.setProperty('color', formatCssColor(adapted), 'important');
    }

    read.borders.forEach((value, side) => {
      const border = value ? parseCssColor(value) : undefined;
      if (border && border.a > 0) {
        el.style.setProperty(
          `border-${SIDES[side]}-color`,
          formatCssColor(adaptBorder(border, palette)),
          'important',
        );
      }
    });

    if (el instanceof SVGElement) {
      const isText = el instanceof SVGTextContentElement;
      const fill = parseCssColor(read.fill);
      if (fill && fill.a > 0) {
        const adapted = isText
          ? adaptForeground(fill, surface, palette)
          : adaptBackground(fill, palette);
        el.style.setProperty('fill', formatCssColor(adapted), 'important');
      }
      const stroke = parseCssColor(read.stroke);
      if (stroke && stroke.a > 0) {
        el.style.setProperty('stroke', formatCssColor(adaptBorder(stroke, palette)), 'important');
      }
    }
  });
}

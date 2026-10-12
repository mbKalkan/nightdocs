import type { SlideRendererOptions } from '@aiden0z/pptx-renderer';
import {
  adaptBackground,
  adaptForeground,
  adaptLine,
  formatCssColor,
  parseCssColor,
  type DarkPalette,
} from '../../shared/color';

export type Chart =
  NonNullable<SlideRendererOptions['chartInstances']> extends Set<infer T> ? T : never;

type Role = 'text' | 'line' | 'fill' | 'keep';

/**
 * Parts of a chart option that aren't drawn until someone interacts with the chart, or that
 * hold the data colors. Data colors stay as authored, like pictures, so the legend still
 * matches and series stay apart.
 */
const UNTOUCHED = new Set([
  'aria',
  'axisPointer',
  'backgroundStyle',
  'blur',
  'breakArea',
  'emphasis',
  'gradientColor',
  'select',
  'tooltip',
]);

/** Label positions drawn on top of the data marks, which keep their colors. */
const INSIDE = /inside|inner|center/i;

/**
 * Charts are drawn on canvases, so the DOM color pass can't reach them. Returns a copy of a
 * chart option with its colors adapted instead: text the way document text is adapted, chart
 * and plot backgrounds like fills, and axis and grid lines so they stay as faint or as clear
 * as they were.
 */
export function adaptChartOption(option: object, palette: DarkPalette): Record<string, unknown> {
  return adaptValue(option, [], palette) as Record<string, unknown>;
}

/** A copy of `value` with its colors adapted; `path` is the chain of keys leading to it. */
function adaptValue(value: unknown, path: readonly string[], palette: DarkPalette): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => adaptValue(item, path, palette));
  }
  // Only plain objects are walked; anything else (functions, typed arrays) goes back as is.
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }
  const object = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object)) {
    const childPath = [...path, key];
    if (UNTOUCHED.has(key) || (path.length === 0 && key === 'color')) {
      result[key] = item;
    } else if (typeof item === 'string') {
      const role = roleOf(childPath, object);
      result[key] = role === 'keep' ? item : adaptColor(item, role, palette);
    } else {
      result[key] = adaptValue(item, childPath, palette);
    }
  }
  return result;
}

/** What a color in the option is drawn as, from where it sits in the option. */
export function roleOf(path: readonly string[], owner: Record<string, unknown>): Role {
  const key = path[path.length - 1];
  const parent = path[path.length - 2] ?? '';
  const inSeries = path[0] === 'series';
  if (!/color$/i.test(key)) return 'keep';
  if (key === 'backgroundColor') return 'fill';
  if (/shadow/i.test(key)) return 'keep';
  if (/border/i.test(key)) return 'line';
  if (parent === 'lineStyle') return inSeries && !path.includes('labelLine') ? 'keep' : 'line';
  if (parent === 'areaStyle') return inSeries ? 'keep' : 'fill';
  if (parent === 'itemStyle') return 'keep';
  if (path.includes('label') || parent === 'label') {
    return typeof owner.position === 'string' && INSIDE.test(owner.position) ? 'keep' : 'text';
  }
  if (/text|label|rich/i.test(path.join('.'))) return 'text';
  return 'keep';
}

function adaptColor(value: string, role: Exclude<Role, 'keep'>, palette: DarkPalette): string {
  const color = parseCssColor(value);
  if (!color || color.a === 0) return value;
  const adapted =
    role === 'text'
      ? adaptForeground(color, palette.background, palette)
      : role === 'line'
        ? adaptLine(color, palette)
        : adaptBackground(color, palette);
  return formatCssColor(adapted);
}

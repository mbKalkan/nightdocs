// Conditional formatting, evaluated once per sheet against the stored cell values. Covers
// the rule types that need no formula engine; `expression` rules and icon sets are skipped.
import { resolveColor } from './excelColors';
import { CellKind, type CellOverride, type CellRange, type SheetData } from './model';
import { parseCellRef, parseRange } from './refs';
import { decodeEntities, elements, firstElement } from './xml';

/** A differential format: the parts of a cell style that a rule changes. */
export type Dxf = Omit<CellOverride, 'bar' | 'hideValue'>;

interface Rule {
  ranges: CellRange[];
  attrs: Record<string, string>;
  body: string;
  priority: number;
}

interface Cell {
  index: number;
  row: number;
  col: number;
}

type Value = number | string | boolean;
type Format = (cell: Cell) => CellOverride | undefined;

export function parseDxfs(stylesXml: string | undefined, theme: string[]): Dxf[] {
  const list = firstElement(stylesXml ?? '', 'dxfs')?.body ?? '';
  return [...elements(list, 'dxf')].map((dxf) => {
    const format: Dxf = {};
    const font = firstElement(dxf.body, 'font');
    if (font) {
      // In a dxf, `<b val="0"/>` turns bold off, and an absent element leaves it alone.
      const flag = (name: string) => {
        const el = firstElement(font.body, name);
        return el && !['0', 'false', 'none'].includes(el.attrs.val);
      };
      const color = resolveColor(firstElement(font.body, 'color')?.attrs, theme);
      if (color) format.color = color;
      for (const [key, tag] of [
        ['bold', 'b'],
        ['italic', 'i'],
        ['strike', 'strike'],
        ['underline', 'u'],
      ] as const) {
        const value = flag(tag);
        if (value !== undefined) format[key] = value;
      }
    }
    const pattern = firstElement(dxf.body, 'patternFill');
    if (pattern && pattern.attrs.patternType !== 'none') {
      // Solid dxf fills keep their color in bgColor.
      const fill =
        resolveColor(firstElement(pattern.body, 'bgColor')?.attrs, theme) ??
        resolveColor(firstElement(pattern.body, 'fgColor')?.attrs, theme);
      if (fill) format.fill = fill;
    }
    return format;
  });
}

/** Formatting that the sheet's conditional rules give its cells, by cell index. */
export function evaluateConditionalFormats(
  xml: string,
  sheet: SheetData,
  dxfs: Dxf[],
  theme: string[],
): Map<number, CellOverride> {
  // The rules follow the cell data; skip scanning it.
  const dataEnd = xml.lastIndexOf('sheetData>');
  const tail = dataEnd >= 0 ? xml.slice(dataEnd) : xml;
  const rules: Rule[] = [];
  for (const block of elements(tail, 'conditionalFormatting')) {
    const ranges = (block.attrs.sqref ?? '').split(/\s+/).flatMap((ref) => {
      const range = parseRange(ref);
      return range ? [range] : [];
    });
    for (const rule of elements(block.body, 'cfRule')) {
      const priority = Number(rule.attrs.priority) || 0;
      rules.push({ ranges, attrs: rule.attrs, body: rule.body, priority });
    }
  }

  const result = new Map<number, CellOverride>();
  const stopped = new Set<number>();
  // Lower numbers come first and win: a later rule only adds what isn't set yet.
  rules.sort((a, b) => a.priority - b.priority);
  for (const rule of rules) {
    const cells = cellsIn(sheet, rule.ranges);
    const format = ruleFormat(rule, cells, sheet, dxfs, theme);
    if (!format) continue;
    const stops = rule.attrs.stopIfTrue === '1' || rule.attrs.stopIfTrue === 'true';
    for (const cell of cells) {
      if (stopped.has(cell.index)) continue;
      const override = format(cell);
      if (!override) continue;
      result.set(cell.index, { ...override, ...result.get(cell.index) });
      if (stops) stopped.add(cell.index);
    }
  }
  return result;
}

function cellsIn(sheet: SheetData, ranges: CellRange[]): Cell[] {
  const cells: Cell[] = [];
  const seen = ranges.length > 1 ? new Set<number>() : undefined;
  for (const range of ranges) {
    const last = Math.min(range.row2, sheet.rowCount - 1);
    for (let row = range.row1; row <= last; row++) {
      for (let index = sheet.rowStarts[row]; index < sheet.rowStarts[row + 1]; index++) {
        const col = sheet.cellCols[index];
        if (col < range.col1) continue;
        if (col > range.col2) break;
        if (seen?.has(index)) continue;
        seen?.add(index);
        cells.push({ index, row, col });
      }
    }
  }
  return cells;
}

function ruleFormat(
  rule: Rule,
  cells: Cell[],
  sheet: SheetData,
  dxfs: Dxf[],
  theme: string[],
): Format | undefined {
  const { attrs } = rule;
  const kind = (cell: Cell) => sheet.cellKinds[cell.index];
  const number = (cell: Cell) => sheet.cellNumbers[cell.index];
  const text = (cell: Cell) => sheet.texts[sheet.cellTexts[cell.index]];
  const numbers = () =>
    cells
      .filter((cell) => kind(cell) === CellKind.Number)
      .map(number)
      .sort((a, b) => a - b);

  const dxf = attrs.dxfId === undefined ? undefined : dxfs[Number(attrs.dxfId)];
  const when = (test: (cell: Cell) => boolean): Format | undefined =>
    dxf && ((cell) => (test(cell) ? dxf : undefined));

  switch (attrs.type) {
    case 'cellIs': {
      const origin = rule.ranges[0];
      const operands = [...elements(rule.body, 'formula')].map((f) =>
        operand(decodeEntities(f.body), sheet, origin),
      );
      const compareTo = operator(attrs.operator ?? 'equal', operands);
      return (
        compareTo &&
        when((cell) => {
          const value = cellValue(sheet, cell.index);
          return value !== undefined && compareTo(value, cell);
        })
      );
    }
    case 'containsText':
    case 'notContainsText':
    case 'beginsWith':
    case 'endsWith': {
      const needle = (attrs.text ?? '').toLowerCase();
      const test = {
        containsText: (s: string) => s.includes(needle),
        notContainsText: (s: string) => !s.includes(needle),
        beginsWith: (s: string) => s.startsWith(needle),
        endsWith: (s: string) => s.endsWith(needle),
      }[attrs.type];
      return when((cell) => test(text(cell).toLowerCase()));
    }
    case 'containsBlanks':
      return when((cell) => text(cell).trim() === '');
    case 'notContainsBlanks':
      return when((cell) => text(cell).trim() !== '');
    case 'containsErrors':
      return when((cell) => kind(cell) === CellKind.Error);
    case 'notContainsErrors':
      return when((cell) => kind(cell) !== CellKind.Error);
    case 'top10': {
      const values = numbers();
      if (!values.length) return undefined;
      const rank = Number(attrs.rank) || 10;
      const percent = attrs.percent === '1' || attrs.percent === 'true';
      const count = Math.min(
        values.length,
        percent ? Math.max(1, Math.floor((values.length * rank) / 100)) : rank,
      );
      const bottom = attrs.bottom === '1' || attrs.bottom === 'true';
      const limit = bottom ? values[count - 1] : values[values.length - count];
      return when(
        (cell) =>
          kind(cell) === CellKind.Number &&
          (bottom ? number(cell) <= limit : number(cell) >= limit),
      );
    }
    case 'aboveAverage': {
      const values = numbers();
      if (!values.length) return undefined;
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const above = attrs.aboveAverage !== '0' && attrs.aboveAverage !== 'false';
      const equal = attrs.equalAverage === '1' || attrs.equalAverage === 'true';
      const spread = attrs.stdDev ? Number(attrs.stdDev) * deviation(values, mean) : 0;
      const limit = above ? mean + spread : mean - spread;
      return when((cell) => {
        if (kind(cell) !== CellKind.Number) return false;
        const value = number(cell);
        return (above ? value > limit : value < limit) || (equal && value === limit);
      });
    }
    case 'duplicateValues':
    case 'uniqueValues': {
      const key = (cell: Cell) =>
        kind(cell) === CellKind.Number ? String(number(cell)) : text(cell).toLowerCase();
      const filled = cells.filter((cell) => kind(cell) !== CellKind.Empty);
      const counts = new Map<string, number>();
      for (const cell of filled) counts.set(key(cell), (counts.get(key(cell)) ?? 0) + 1);
      const duplicates = attrs.type === 'duplicateValues';
      return when(
        (cell) => kind(cell) !== CellKind.Empty && counts.get(key(cell))! > 1 === duplicates,
      );
    }
    case 'colorScale': {
      const scale = firstElement(rule.body, 'colorScale');
      const values = numbers();
      if (!scale || !values.length) return undefined;
      const stops = [...elements(scale.body, 'cfvo')].map((cfvo) => threshold(cfvo.attrs, values));
      const colors = [...elements(scale.body, 'color')].map((c) => resolveColor(c.attrs, theme));
      if (
        stops.length < 2 ||
        stops.length !== colors.length ||
        stops.some((stop) => stop === undefined) ||
        colors.some((color) => !color)
      ) {
        return undefined;
      }
      return (cell) =>
        kind(cell) === CellKind.Number
          ? { fill: scaleColor(number(cell), stops as number[], colors as string[]) }
          : undefined;
    }
    case 'dataBar': {
      const bar = firstElement(rule.body, 'dataBar');
      const values = numbers();
      if (!bar || !values.length) return undefined;
      const [low, high] = [...elements(bar.body, 'cfvo')].map((cfvo) =>
        threshold(cfvo.attrs, values),
      );
      const color = resolveColor(firstElement(bar.body, 'color')?.attrs, theme);
      if (low === undefined || high === undefined || !color) return undefined;
      const shortest = (Number(bar.attrs.minLength ?? 10) || 0) / 100;
      const longest = (Number(bar.attrs.maxLength ?? 90) || 0) / 100;
      const hideValue = bar.attrs.showValue === '0' || bar.attrs.showValue === 'false';
      return (cell) => {
        if (kind(cell) !== CellKind.Number) return undefined;
        const share = high > low ? clamp((number(cell) - low) / (high - low), 0, 1) : 1;
        const length = shortest + (longest - shortest) * share;
        return hideValue ? { bar: { length, color }, hideValue } : { bar: { length, color } };
      };
    }
    default:
      return undefined;
  }
}

/** A `cellIs` operand: a number, a string, a boolean or a single cell reference. */
function operand(
  formula: string,
  sheet: SheetData,
  origin: CellRange,
): ((cell: Cell) => Value) | undefined {
  const source = formula.trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(source)) {
    const value = parseFloat(source);
    return () => value;
  }
  const quoted = /^"((?:[^"]|"")*)"$/.exec(source);
  if (quoted) {
    const value = quoted[1].replace(/""/g, '"');
    return () => value;
  }
  if (/^(true|false)$/i.test(source)) {
    const value = source.toLowerCase() === 'true';
    return () => value;
  }
  const ref = /^(\$?)[A-Z]{1,3}(\$?)\d+$/i.exec(source);
  const target = ref && parseCellRef(source);
  if (!ref || !target) return undefined;
  // Relative references move with the cell, measured from the range's top-left corner.
  return (cell) => {
    const row = ref[2] ? target.row : target.row + cell.row - origin.row1;
    const col = ref[1] ? target.col : target.col + cell.col - origin.col1;
    return valueAt(sheet, row, col);
  };
}

function operator(
  name: string,
  operands: (((cell: Cell) => Value) | undefined)[],
): ((value: Value, cell: Cell) => boolean) | undefined {
  const [first, second] = operands;
  if (!first) return undefined;
  if (name === 'between' || name === 'notBetween') {
    if (!second) return undefined;
    return (value, cell) => {
      const [a, b] = [first(cell), second(cell)];
      const [low, high] = compare(a, b) <= 0 ? [a, b] : [b, a];
      const inside = compare(value, low) >= 0 && compare(value, high) <= 0;
      return name === 'between' ? inside : !inside;
    };
  }
  const test = {
    equal: (c: number) => c === 0,
    notEqual: (c: number) => c !== 0,
    greaterThan: (c: number) => c > 0,
    greaterThanOrEqual: (c: number) => c >= 0,
    lessThan: (c: number) => c < 0,
    lessThanOrEqual: (c: number) => c <= 0,
  }[name];
  return test && ((value, cell) => test(compare(value, first(cell))));
}

/**
 * Excel's ordering for comparisons: numbers, then text (ignoring case), then booleans.
 * Empty cells are skipped rather than compared as zero, since only styled ones exist here.
 */
function compare(a: Value, b: Value): number {
  const rank = (v: Value) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const x = typeof a === 'string' ? a.toLowerCase() : Number(a);
  const y = typeof b === 'string' ? b.toLowerCase() : Number(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function cellValue(sheet: SheetData, index: number): Value | undefined {
  switch (sheet.cellKinds[index]) {
    case CellKind.Number:
      return sheet.cellNumbers[index];
    case CellKind.Text:
      return sheet.texts[sheet.cellTexts[index]];
    case CellKind.Boolean:
      return sheet.texts[sheet.cellTexts[index]] === 'TRUE';
    default:
      return undefined;
  }
}

/** A referenced cell's value; empty cells count as 0, as in Excel formulas. */
function valueAt(sheet: SheetData, row: number, col: number): Value {
  if (row < 0 || row >= sheet.rowCount) return 0;
  for (let index = sheet.rowStarts[row]; index < sheet.rowStarts[row + 1]; index++) {
    if (sheet.cellCols[index] === col) return cellValue(sheet, index) ?? 0;
  }
  return 0;
}

/** A color scale or data bar end point, from the sorted numbers it applies to. */
function threshold(attrs: Record<string, string>, sorted: number[]): number | undefined {
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const value = attrs.val === undefined ? NaN : Number(attrs.val);
  switch (attrs.type) {
    case 'min':
    case 'autoMin':
      return min;
    case 'max':
    case 'autoMax':
      return max;
    case 'num':
    case 'formula':
      // Formulas other than plain numbers would need an engine.
      return Number.isFinite(value) ? value : undefined;
    case 'percent':
      return Number.isFinite(value) ? min + ((max - min) * value) / 100 : undefined;
    case 'percentile':
      return Number.isFinite(value) ? percentile(sorted, value / 100) : undefined;
    default:
      return undefined;
  }
}

/** Excel's PERCENTILE.INC. */
function percentile(sorted: number[], p: number): number {
  const position = clamp(p, 0, 1) * (sorted.length - 1);
  const below = Math.floor(position);
  const above = Math.min(below + 1, sorted.length - 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

/** Sample standard deviation, as Excel's average rules use. */
function deviation(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const squares = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1));
}

function scaleColor(value: number, stops: number[], colors: string[]): string {
  if (value <= stops[0]) return colors[0];
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i]) {
      const span = stops[i] - stops[i - 1];
      return mix(colors[i - 1], colors[i], span > 0 ? (value - stops[i - 1]) / span : 1);
    }
  }
  return colors[colors.length - 1];
}

/** Mixes two `#rrggbb` colors in RGB, as Excel's color scales do. */
function mix(from: string, to: string, amount: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  let result = '#';
  for (let i = 0; i < 3; i++) {
    const value = Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * amount);
    result += value.toString(16).padStart(2, '0');
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

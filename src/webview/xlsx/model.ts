// Data passed from the parsing worker to the grid. Sheets use flat typed arrays so large
// sheets stay compact and transfer to the main thread without copying.

export interface BorderSide {
  style: string;
  /** `#rrggbb`, or undefined for Excel's automatic (black) color. */
  color?: string;
}

export interface CellStyle {
  bold: boolean;
  italic: boolean;
  underline: 'none' | 'single' | 'double';
  strike: boolean;
  /** Font size in points. */
  size: number;
  fontName: string;
  color?: string;
  fill?: string;
  border: { top?: BorderSide; right?: BorderSide; bottom?: BorderSide; left?: BorderSide };
  horizontal: string;
  vertical: string;
  wrap: boolean;
  indent: number;
}

export interface SheetInfo {
  name: string;
  hidden: boolean;
  tabColor?: string;
}

export interface WorkbookInfo {
  sheets: SheetInfo[];
  /** Index of the sheet Excel had open when the file was saved. */
  activeSheet: number;
  styles: CellStyle[];
}

export const CellKind = {
  Empty: 0,
  Number: 1,
  Text: 2,
  Boolean: 3,
  Error: 4,
} as const;

/** Inclusive, 0-based. */
export interface CellRange {
  row1: number;
  col1: number;
  row2: number;
  col2: number;
}

/** What conditional formatting changes in a cell, on top of its own style. */
export interface CellOverride {
  fill?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  /** Data bar: length as a share of the cell width, and its color. */
  bar?: { length: number; color: string };
  /** Data bars can hide the value. */
  hideValue?: boolean;
}

/** A cell position plus an offset in pixels, as drawings are anchored. */
export interface CellAnchor {
  row: number;
  col: number;
  rowOffset: number;
  colOffset: number;
}

/** Something drawn over the grid: a picture, a chart (shown as a placeholder) or a text box. */
export interface Drawing {
  kind: 'picture' | 'chart' | 'text';
  from: CellAnchor;
  /** Bottom-right corner for two-cell anchors. */
  to?: CellAnchor;
  /** Size in pixels for one-cell anchors. */
  width?: number;
  height?: number;
  image?: Uint8Array<ArrayBuffer>;
  mime?: string;
  /** Chart title or text box content. */
  text?: string;
  /** Text box colors. */
  fill?: string;
  color?: string;
}

export interface SheetData {
  /** Rows and columns that contain data, merges or formatting. */
  rowCount: number;
  colCount: number;
  /** Cells of row `r` are at indices `rowStarts[r]` to `rowStarts[r + 1] - 1`, ordered by column. */
  rowStarts: Uint32Array;
  cellCols: Uint16Array;
  cellStyles: Uint32Array;
  cellKinds: Uint8Array;
  /** Index into `texts`: the value as Excel displays it. */
  cellTexts: Uint32Array;
  /** Numeric value for number cells, NaN otherwise. */
  cellNumbers: Float64Array;
  /** Color forced by the number format (e.g. `[Red]` for negatives), index into `formatColors`. */
  cellFormatColors: Uint8Array;
  texts: string[];
  /** Widths and heights in CSS pixels at 100% zoom; 0 for hidden. Beyond the arrays, defaults apply. */
  colWidths: Float32Array;
  rowHeights: Float32Array;
  defaultColWidth: number;
  defaultRowHeight: number;
  /** Merged ranges as flat [row1, col1, row2, col2, ...] (inclusive, 0-based). */
  merges: Uint32Array;
  frozenRows: number;
  frozenCols: number;
  showGridLines: boolean;
  drawings: Drawing[];
  /** Formulas as Excel's formula bar shows them ("=SUM(A1:A3)"), by cell index. */
  formulas: Map<number, string>;
  /** Conditional formatting results, by cell index. */
  conditional: Map<number, CellOverride>;
  /** Default styles of whole rows and columns, which also cover the cells the file omits. */
  rowStyles: Map<number, number>;
  colStyles: { min: number; max: number; style: number }[];
}

/** Colors number formats can force, by `cellFormatColors` index (0 = none). */
export const FORMAT_COLORS = [
  '',
  '#000000',
  '#0000ff',
  '#00ffff',
  '#00ff00',
  '#ff00ff',
  '#ff0000',
  '#ffffff',
  '#ffff00',
] as const;

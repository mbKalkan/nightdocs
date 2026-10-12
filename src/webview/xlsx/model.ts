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

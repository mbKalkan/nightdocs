export interface Cell {
  ref: string;
  value: string | number | boolean | null;
  style?: number;
  error?: boolean;
  formula?: string;
}

export interface Sheet {
  name: string;
  hidden?: boolean;
  tabColor?: string;
  frozen?: { rows: number; cols: number };
  showGridLines?: boolean;
  cols?: { min: number; max: number; width: number; hidden?: boolean }[];
  rowHeights?: Record<number, number>;
  hiddenRows?: number[];
  merges?: string[];
  cells: Cell[];
}

export interface Styles {
  numFmts?: string[];
  fonts: string[];
  fills: string[];
  borders: string[];
  cellXfs: string[];
}

export function writeXlsx(workbook: {
  sheets: Sheet[];
  styles: Styles;
  activeSheet?: number;
}): Promise<Buffer>;

export function columnLetters(col: number): string;

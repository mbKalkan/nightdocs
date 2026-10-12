export interface Cell {
  ref: string;
  value: string | number | boolean | null;
  style?: number;
  error?: boolean;
  formula?: string;
}

/** 0-based cell. */
export interface Point {
  col: number;
  row: number;
}

/** Pixels. */
export interface Size {
  width: number;
  height: number;
}

export interface Series {
  name: string;
  categories: string;
  values: string;
  labels: string[];
  numbers: number[];
}

export type Drawing =
  | { type: 'picture'; from: Point; to?: Point; size?: Size; png: Buffer }
  | { type: 'chart'; from: Point; to: Point; title?: string; axisTitle?: string; series: Series }
  | { type: 'text'; from: Point; size: Size; text: string; fill?: string };

export interface Sheet {
  name: string;
  hidden?: boolean;
  tabColor?: string;
  frozen?: { rows: number; cols: number };
  showGridLines?: boolean;
  cols?: { min: number; max: number; width: number; hidden?: boolean; style?: number }[];
  rowHeights?: Record<number, number>;
  /** Default style of whole rows. */
  rowStyles?: Record<number, number>;
  hiddenRows?: number[];
  merges?: string[];
  cells: Cell[];
  /** `<conditionalFormatting>` elements as XML. */
  conditionalFormats?: string[];
  drawings?: Drawing[];
}

export interface Styles {
  numFmts?: string[];
  fonts: string[];
  fills: string[];
  borders: string[];
  cellXfs: string[];
  dxfs?: string[];
}

export function writeXlsx(workbook: {
  sheets: Sheet[];
  styles: Styles;
  activeSheet?: number;
}): Promise<Buffer>;

export function columnLetters(col: number): string;

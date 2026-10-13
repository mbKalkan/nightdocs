// Messages exchanged between the extension host and the webview.

export type DocumentFormat = 'docx' | 'xlsx' | 'pptx';

/** `dark` adapts document colors to dark themes; `original` shows them as authored. */
export type ColorMode = 'dark' | 'original';

/** UI strings localized by the extension host and handed to the webview. */
export interface ViewerStrings {
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  showOriginalColors: string;
  showDarkColors: string;
  openInOffice: string;
  openInOfficeTooltip: string;
  loading: string;
  errorTitle: string;
  errorDamaged: string;
  errorProtectedOrLegacy: string;
  errorRender: string;
  errorRead: string;
  errorEmpty: string;
  /** Status bar templates for spreadsheet selections; `{0}` is the value. */
  statusCount: string;
  statusSum: string;
  statusAverage: string;
  find: string;
  findNoResults: string;
  /** `{0} of {1}` */
  findCount: string;
  findPrevious: string;
  findNext: string;
  findClose: string;
  chart: string;
  chartHint: string;
  /** Accessible name of the sheet tab list. */
  sheets: string;
  /** Buttons shown when the sheet tabs don't all fit. */
  allSheets: string;
  scrollSheetsLeft: string;
  scrollSheetsRight: string;
  /** `Slide {0}`, the accessible name of a slide. */
  slide: string;
  /** `Slide {0} of {1}`, shown in the status bar of presentations. */
  slidePosition: string;
  hiddenSlide: string;
  /** Status bar text when comparing two versions; `{0}` is a number. */
  noChanges: string;
  oneChange: string;
  changeCount: string;
  /** `Change {0} of {1}` */
  changePosition: string;
  previousChange: string;
  nextChange: string;
}

/** Which version a viewer shows when VS Code compares two files side by side. */
export type DiffSide = 'original' | 'modified';

/** What a viewer shares with the other side of a comparison to find the differences. */
export type DocumentSummary = WordSummary | WorkbookSummary | PresentationSummary;

export interface WordSummary {
  format: 'docx';
  /** Text of each paragraph of the body, in order; pictures count as U+FFFC. */
  blocks: string[];
}

export interface WorkbookSummary {
  format: 'xlsx';
  /** Visible sheets, in tab order. */
  sheets: SheetSummary[];
}

export interface SheetSummary {
  name: string;
  /** Each row's displayed values, separated by `CELL_SEPARATOR` at their column positions. */
  rows: string[];
}

export interface PresentationSummary {
  format: 'pptx';
  slides: SlideSummary[];
}

export interface SlideSummary {
  /** The slide's text in reading order, whitespace collapsed. */
  text: string;
  /** A fingerprint of each picture's pixels, so a replaced picture counts as a change. */
  pictures: string[];
  /** Each chart's categories and series values. */
  charts: string[];
  hidden: boolean;
}

/** Separates cells in `SheetSummary.rows`; not something a cell shows. */
export const CELL_SEPARATOR = '\u001f';

/**
 * A scroll position in the receiver's terms: `fraction` of the way through item `index`
 * (a paragraph, a slide, a row) is at the top of the window.
 */
export interface ScrollAnchor {
  index: number;
  fraction: number;
  /** For spreadsheets: the sheet, and the column and fraction of it at the left edge. */
  sheet?: string;
  column?: number;
  columnFraction?: number;
}

export interface LoadMessage {
  type: 'load';
  fileName: string;
  format: DocumentFormat;
  data: Uint8Array;
  /** True when the file changed on disk and the view should keep its position. */
  reload: boolean;
  canOpenInOffice: boolean;
  colorMode: ColorMode;
  /** The user's locale, for dates and numbers shown the way their Office would. */
  locale: string;
  strings: ViewerStrings;
}

export interface ReadErrorMessage {
  type: 'readError';
  fileName: string;
  format: DocumentFormat;
  canOpenInOffice: boolean;
  strings: ViewerStrings;
}

export interface ZoomMessage {
  type: 'zoom';
  action: ZoomAction;
}

export type ZoomAction = 'in' | 'out' | 'reset';

export type ViewerCommand = 'nextSheet' | 'previousSheet' | 'goToSheet' | 'find';

export interface CommandMessage {
  type: 'command';
  command: ViewerCommand;
}

/** The viewer is one side of a comparison; `diff` with no side means it no longer is. */
export interface DiffMessage {
  type: 'diff';
  side: DiffSide | undefined;
}

export interface PeerSummaryMessage {
  type: 'peerSummary';
  summary: DocumentSummary;
}

export interface PeerScrollMessage {
  type: 'peerScroll';
  anchor: ScrollAnchor;
}

/** The sheet picked from the list `pickSheet` asked for. */
export interface ShowSheetMessage {
  type: 'showSheet';
  sheet: string;
}

/** A sheet as listed to pick from. */
export interface SheetChoice {
  name: string;
  current: boolean;
  /** When comparing, whether the sheet has changes. */
  changed: boolean;
}

export type HostToWebviewMessage =
  | LoadMessage
  | ReadErrorMessage
  | ZoomMessage
  | CommandMessage
  | DiffMessage
  | PeerSummaryMessage
  | PeerScrollMessage
  | ShowSheetMessage;

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'openInOffice' }
  | { type: 'setColorMode'; mode: ColorMode }
  | { type: 'summary'; summary: DocumentSummary }
  /** Where the other side should scroll to, in its own terms. */
  | { type: 'scroll'; anchor: ScrollAnchor }
  /** Asks for a list of the sheets to pick one from; the answer is a `showSheet` message. */
  | { type: 'pickSheet'; sheets: SheetChoice[] };

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
export type DocumentSummary = WordSummary;

export interface WordSummary {
  format: 'docx';
  /** Text of each paragraph of the body, in order; pictures count as U+FFFC. */
  blocks: string[];
}

/**
 * A scroll position in the receiver's terms: `fraction` of the way through item `index`
 * (a paragraph, a slide, a row) is at the top of the window.
 */
export interface ScrollAnchor {
  index: number;
  fraction: number;
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

export type ViewerCommand = 'nextSheet' | 'previousSheet' | 'find';

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

export type HostToWebviewMessage =
  | LoadMessage
  | ReadErrorMessage
  | ZoomMessage
  | CommandMessage
  | DiffMessage
  | PeerSummaryMessage
  | PeerScrollMessage;

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'openInOffice' }
  | { type: 'setColorMode'; mode: ColorMode }
  | { type: 'summary'; summary: DocumentSummary }
  /** Where the other side should scroll to, in its own terms. */
  | { type: 'scroll'; anchor: ScrollAnchor };

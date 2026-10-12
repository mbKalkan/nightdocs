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

export type HostToWebviewMessage = LoadMessage | ReadErrorMessage | ZoomMessage | CommandMessage;

export type WebviewToHostMessage =
  { type: 'ready' } | { type: 'openInOffice' } | { type: 'setColorMode'; mode: ColorMode };

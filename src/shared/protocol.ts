// Messages exchanged between the extension host and the webview.

export type DocumentFormat = 'docx';

/** UI strings localized by the extension host and handed to the webview. */
export interface ViewerStrings {
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  openInOffice: string;
  openInOfficeTooltip: string;
  loading: string;
  errorTitle: string;
  errorDamaged: string;
  errorProtectedOrLegacy: string;
  errorRender: string;
  errorRead: string;
}

export interface LoadMessage {
  type: 'load';
  fileName: string;
  format: DocumentFormat;
  data: Uint8Array;
  /** True when the file changed on disk and the view should keep its position. */
  reload: boolean;
  canOpenInOffice: boolean;
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

export type HostToWebviewMessage = LoadMessage | ReadErrorMessage | ZoomMessage;

export type WebviewToHostMessage = { type: 'ready' } | { type: 'openInOffice' };

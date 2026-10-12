import type { WebviewToHostMessage } from '../shared/protocol';

export interface ViewState {
  /** Fixed zoom factor, or `null` to fit the page to the window width. */
  zoom: number | null;
  scrollRatio: number;
}

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();

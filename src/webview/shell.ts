import type { DocumentFormat, ViewerStrings } from '../shared/protocol';
import { formatZoom } from '../shared/zoom';
import { icons } from './icons';

export interface ShellHandlers {
  onZoomIn(): void;
  onZoomOut(): void;
  onResetZoom(): void;
  onOpenInOffice(): void;
  onToggleColors(): void;
}

/** The static frame around a document: toolbar, scrollable viewport and status overlays. */
export class Shell {
  readonly viewport: HTMLElement;
  readonly content: HTMLElement;
  private readonly root: HTMLElement;
  private readonly fileName: HTMLElement;
  private readonly fileIcon: HTMLElement;
  private readonly colorsButton: HTMLButtonElement;
  private readonly colorsSeparator: HTMLElement;
  private readonly zoomOut: HTMLButtonElement;
  private readonly zoomLabel: HTMLButtonElement;
  private readonly zoomIn: HTMLButtonElement;
  private readonly openButton: HTMLButtonElement;
  private readonly openLabel: HTMLElement;
  private readonly separator: HTMLElement;
  private readonly progress: HTMLElement;

  constructor(container: HTMLElement, handlers: ShellHandlers) {
    container.innerHTML = `
      <div class="ov-shell">
        <header class="ov-toolbar" role="toolbar">
          <div class="ov-title">
            <span class="ov-file-icon">${icons.document}</span>
            <span class="ov-file-name"></span>
          </div>
          <div class="ov-actions">
            <button class="ov-icon-button" data-action="colors" type="button" hidden>${icons.colors}</button>
            <span class="ov-separator" data-separator="colors" role="separator" hidden></span>
            <button class="ov-icon-button" data-action="zoom-out" type="button">${icons.zoomOut}</button>
            <button class="ov-zoom-label" data-action="reset-zoom" type="button">100%</button>
            <button class="ov-icon-button" data-action="zoom-in" type="button">${icons.zoomIn}</button>
            <span class="ov-separator" data-separator="open" role="separator"></span>
            <button class="ov-button" data-action="open" type="button" hidden>
              ${icons.openExternal}<span class="ov-button-label"></span>
            </button>
          </div>
        </header>
        <div class="ov-progress" role="progressbar" hidden></div>
        <main class="ov-viewport" tabindex="0">
          <div class="ov-content"></div>
        </main>
      </div>`;

    const find = <T extends HTMLElement>(selector: string) =>
      container.querySelector(selector) as T;
    this.root = find('.ov-shell');
    this.fileName = find('.ov-file-name');
    this.fileIcon = find('.ov-file-icon');
    this.colorsButton = find('[data-action="colors"]');
    this.colorsSeparator = find('[data-separator="colors"]');
    this.zoomOut = find('[data-action="zoom-out"]');
    this.zoomLabel = find('[data-action="reset-zoom"]');
    this.zoomIn = find('[data-action="zoom-in"]');
    this.openButton = find('[data-action="open"]');
    this.openLabel = find('.ov-button-label');
    this.separator = find('[data-separator="open"]');
    this.progress = find('.ov-progress');
    this.viewport = find('.ov-viewport');
    this.content = find('.ov-content');

    this.zoomOut.addEventListener('click', handlers.onZoomOut);
    this.zoomIn.addEventListener('click', handlers.onZoomIn);
    this.zoomLabel.addEventListener('click', handlers.onResetZoom);
    this.openButton.addEventListener('click', handlers.onOpenInOffice);
    this.colorsButton.addEventListener('click', handlers.onToggleColors);
  }

  /**
   * Shows the dark/original colors toggle (only useful in dark themes) and marks whether
   * the document is currently shown with adapted colors.
   */
  setColors(available: boolean, dark: boolean, strings: ViewerStrings): void {
    this.colorsButton.hidden = !available;
    this.colorsSeparator.hidden = !available;
    this.colorsButton.setAttribute('aria-pressed', String(dark));
    this.colorsButton.setAttribute('aria-label', strings.showDarkColors);
    this.colorsButton.title = dark ? strings.showOriginalColors : strings.showDarkColors;
    this.root.dataset.colors = available && dark ? 'dark' : 'original';
  }

  setDocument(
    fileName: string,
    format: DocumentFormat,
    canOpenInOffice: boolean,
    strings: ViewerStrings,
  ): void {
    this.root.dataset.format = format;
    this.fileName.textContent = fileName;
    this.fileName.title = fileName;
    this.fileIcon.dataset.format = format;
    document.title = fileName;

    this.label(this.zoomOut, strings.zoomOut);
    this.label(this.zoomIn, strings.zoomIn);
    this.label(this.zoomLabel, strings.resetZoom);
    this.openLabel.textContent = strings.openInOffice;
    this.openButton.title = strings.openInOfficeTooltip;
    this.openButton.hidden = !canOpenInOffice;
    this.separator.hidden = !canOpenInOffice;
    this.progress.setAttribute('aria-label', strings.loading);
  }

  setZoom(zoom: number): void {
    this.zoomLabel.textContent = formatZoom(zoom);
  }

  setZoomEnabled(enabled: boolean): void {
    for (const button of [this.zoomOut, this.zoomLabel, this.zoomIn]) {
      button.disabled = !enabled;
    }
  }

  setBusy(busy: boolean): void {
    this.progress.hidden = !busy;
    this.viewport.setAttribute('aria-busy', String(busy));
  }

  showError(title: string, message: string, actionLabel: string | undefined): void {
    this.setZoomEnabled(false);
    this.colorsButton.hidden = true;
    this.colorsSeparator.hidden = true;
    this.root.dataset.colors = 'original';
    this.content.style.zoom = '';
    this.content.innerHTML = `
      <div class="ov-error" role="alert">
        <div class="ov-error-icon">${icons.error}</div>
        <h1 class="ov-error-title"></h1>
        <p class="ov-error-message"></p>
      </div>`;
    (this.content.querySelector('.ov-error-title') as HTMLElement).textContent = title;
    (this.content.querySelector('.ov-error-message') as HTMLElement).textContent = message;
    if (actionLabel) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ov-button ov-button-primary';
      button.innerHTML = `${icons.openExternal}<span></span>`;
      (button.querySelector('span') as HTMLElement).textContent = actionLabel;
      button.addEventListener('click', () => this.openButton.click());
      this.content.querySelector('.ov-error')?.append(button);
    }
  }

  private label(button: HTMLButtonElement, text: string): void {
    button.title = text;
    button.setAttribute('aria-label', text);
  }
}

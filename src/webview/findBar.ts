import type { ViewerStrings } from '../shared/protocol';
import { icons } from './icons';

export interface FindHandler {
  /** Runs a search and returns the number of matches. */
  search(query: string): number;
  /** Moves to the next (1) or previous (-1) match; returns its 1-based position, or 0. */
  step(direction: 1 | -1): number;
  /** Clears match highlighting. */
  clear(): void;
}

/** A small find widget in the style of VS Code's, for content the built-in find can't see. */
export class FindBar {
  private readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private total = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    container: HTMLElement,
    private readonly handler: FindHandler,
    private readonly strings: ViewerStrings,
    private readonly onClose: () => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'ov-find';
    this.element.hidden = true;
    this.element.setAttribute('role', 'search');
    this.element.innerHTML = `
      <input class="ov-find-input" type="text" spellcheck="false">
      <span class="ov-find-count" aria-live="polite"></span>
      <button class="ov-icon-button" data-find="previous" type="button">${icons.arrowUp}</button>
      <button class="ov-icon-button" data-find="next" type="button">${icons.arrowDown}</button>
      <button class="ov-icon-button" data-find="close" type="button">${icons.close}</button>`;
    container.append(this.element);

    this.input = this.element.querySelector('input') as HTMLInputElement;
    this.count = this.element.querySelector('.ov-find-count') as HTMLElement;
    this.input.placeholder = strings.find;
    this.input.setAttribute('aria-label', strings.find);
    const button = (name: string, label: string, action: () => void) => {
      const el = this.element.querySelector(`[data-find="${name}"]`) as HTMLButtonElement;
      el.title = label;
      el.setAttribute('aria-label', label);
      el.addEventListener('click', action);
    };
    button('previous', strings.findPrevious, () => this.step(-1));
    button('next', strings.findNext, () => this.step(1));
    button('close', strings.findClose, () => this.close());

    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(), 120);
    });
    this.input.addEventListener('keydown', (event) => {
      // Keep the viewer's own keyboard handling (selection) out of the input.
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        clearTimeout(this.timer);
        if (this.timer !== undefined) {
          this.timer = undefined;
          this.run();
        } else {
          this.step(event.shiftKey ? -1 : 1);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    this.element.hidden = false;
    this.input.focus();
    this.input.select();
    if (this.input.value) this.run();
  }

  close(): void {
    clearTimeout(this.timer);
    this.element.hidden = true;
    this.handler.clear();
    this.onClose();
  }

  /** Re-runs the current query, e.g. after the content changed. */
  refresh(): void {
    if (this.isOpen && this.input.value) this.run();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.element.remove();
  }

  private run(): void {
    this.timer = undefined;
    const query = this.input.value;
    if (!query) {
      this.handler.clear();
      this.total = 0;
      this.showCount(0);
      return;
    }
    this.total = this.handler.search(query);
    this.showCount(this.total > 0 ? this.handler.step(1) : 0);
  }

  private step(direction: 1 | -1): void {
    if (this.total > 0) this.showCount(this.handler.step(direction));
  }

  private showCount(position: number): void {
    this.element.classList.toggle('ov-find-empty', !!this.input.value && this.total === 0);
    this.count.textContent = !this.input.value
      ? ''
      : this.total === 0
        ? this.strings.findNoResults
        : this.strings.findCount
            .replace('{0}', String(position))
            .replace('{1}', String(this.total));
  }
}

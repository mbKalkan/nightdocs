import type { DiffSide, DocumentSummary, ScrollAnchor, ViewerStrings } from '../../shared/protocol';
import { icons } from '../icons';
import type { Comparison, RenderContext, RenderedDocument } from '../renderers/types';
import { vscode } from '../vscodeApi';

/** Canvas left visible above a change brought into view. */
const REVEAL_MARGIN = 48;

/** Scroll positions both sides share as they are, whatever the content. */
const TOP = -1;
const BOTTOM = -2;

interface Target {
  document: RenderedDocument;
  context: RenderContext;
  strings: ViewerStrings;
}

/**
 * The webview's part of a comparison: shares this document's summary with the other side,
 * marks the differences once both are known, scrolls along with the other side, and moves
 * between changes from the status bar or with F7 / Shift+F7.
 */
export class DiffController {
  private side: DiffSide | undefined;
  private peer: DocumentSummary | undefined;
  private target: Target | undefined;
  private comparison: Comparison | undefined;
  /** Change last moved to, for the status bar. */
  private position = -1;
  /** Scroll position set to follow the other side; its scroll event isn't passed back. */
  private following: number | undefined;
  private revealed = false;
  private readonly cleanup: (() => void)[] = [];

  setSide(side: DiffSide | undefined): void {
    this.side = side;
    if (!side) this.peer = undefined;
    this.publish();
    this.update();
  }

  setPeer(summary: DocumentSummary): void {
    this.peer = summary;
    this.update();
  }

  /** Takes over a document once it is on screen. */
  attach(document: RenderedDocument, context: RenderContext, strings: ViewerStrings): void {
    this.detach();
    this.target = { document, context, strings };
    this.publish();
    this.update();
  }

  /** Lets go of the document before it is replaced. */
  detach(): void {
    this.stop();
    this.target = undefined;
  }

  /** Scrolls to where the other side is. */
  follow(anchor: ScrollAnchor): void {
    const viewport = this.target?.context.viewport;
    if (!viewport || !this.comparison) return;
    if (anchor.index === TOP) viewport.scrollTop = 0;
    else if (anchor.index === BOTTOM) viewport.scrollTop = viewport.scrollHeight;
    else this.comparison.scrollTo(anchor);
    this.following = viewport.scrollTop;
  }

  private publish(): void {
    const summary = this.side ? this.target?.document.summary?.() : undefined;
    if (summary) vscode.postMessage({ type: 'summary', summary });
  }

  private update(): void {
    this.stop();
    const { side, peer, target } = this;
    if (!side || !peer || !target) return;
    this.comparison = target.document.compare?.(peer, side, target.context);
    if (!this.comparison) return;
    this.showBar(target);
    this.listen(target.context.viewport);
    // Like VS Code's diff editor, open at the first change. The other side follows.
    if (side === 'modified' && !this.revealed && target.context.viewport.scrollTop === 0) {
      this.revealed = true;
      this.go(1, false);
    }
  }

  private stop(): void {
    this.cleanup.splice(0).forEach((fn) => fn());
    this.comparison?.dispose();
    this.comparison = undefined;
    this.position = -1;
  }

  private showBar({ context, strings }: Target): void {
    const bar = document.createElement('div');
    bar.className = 'ov-diff';
    bar.setAttribute('role', 'group');
    const button = (label: string, icon: string, direction: number) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'ov-icon-button';
      element.innerHTML = icon;
      element.title = label;
      element.setAttribute('aria-label', label);
      element.addEventListener('click', () => this.go(direction));
      return element;
    };
    const status = document.createElement('span');
    status.className = 'ov-diff-status';
    status.setAttribute('aria-live', 'polite');
    bar.append(
      button(strings.previousChange, icons.arrowUp, -1),
      button(strings.nextChange, icons.arrowDown, 1),
      status,
    );
    const { footer } = context;
    footer.append(bar);
    footer.hidden = false;
    this.renderStatus(status, strings);
    this.cleanup.push(() => {
      bar.remove();
      footer.hidden = footer.childElementCount === 0;
    });
  }

  private renderStatus(status: HTMLElement, strings: ViewerStrings): void {
    const count = this.comparison?.changeTops().length ?? 0;
    status.textContent =
      count === 0
        ? strings.noChanges
        : this.position >= 0
          ? strings.changePosition
              .replace('{0}', String(this.position + 1))
              .replace('{1}', String(count))
          : count === 1
            ? strings.oneChange
            : strings.changeCount.replace('{0}', String(count));
    for (const button of status.parentElement?.querySelectorAll('button') ?? []) {
      button.disabled = count === 0;
    }
  }

  private listen(viewport: HTMLElement): void {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.share(viewport));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // F7 is VS Code's "Go to Next Difference", Alt+F5 its "Go to Next Change".
      const next = event.key === 'F7' || (event.key === 'F5' && event.altKey);
      if (!next || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      this.go(event.shiftKey ? -1 : 1);
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    this.cleanup.push(() => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKeyDown);
    });
  }

  /** Tells the other side where this one scrolled to, unless it was following that side. */
  private share(viewport: HTMLElement): void {
    if (this.following !== undefined) {
      const followed = Math.abs(viewport.scrollTop - this.following) < 2;
      this.following = undefined;
      if (followed) return;
    }
    const max = viewport.scrollHeight - viewport.clientHeight;
    const anchor =
      viewport.scrollTop <= 0
        ? { index: TOP, fraction: 0 }
        : viewport.scrollTop >= max - 1
          ? { index: BOTTOM, fraction: 0 }
          : this.comparison?.anchor();
    if (anchor) vscode.postMessage({ type: 'scroll', anchor });
  }

  /** Scrolls to the next (1) or previous (-1) change, wrapping around at the ends. */
  private go(direction: number, announce = true): void {
    const target = this.target;
    const tops = this.comparison?.changeTops() ?? [];
    if (!target || tops.length === 0) return;
    const { viewport, footer } = target.context;
    const at = viewport.scrollTop + REVEAL_MARGIN;
    let index =
      direction > 0
        ? tops.findIndex((top) => top > at + 1)
        : tops.length - 1 - [...tops].reverse().findIndex((top) => top < at - 1);
    if (index < 0 || index >= tops.length) index = direction > 0 ? 0 : tops.length - 1;
    this.position = index;
    viewport.scrollTop = Math.max(0, tops[index] - REVEAL_MARGIN);
    const status = footer.querySelector<HTMLElement>('.ov-diff-status');
    if (status && announce) this.renderStatus(status, target.strings);
  }
}

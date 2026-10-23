import type {
  CellSelection,
  DiffSide,
  DocumentSummary,
  ScrollAnchor,
  ViewerStrings,
} from '../../shared/protocol';
import { icons } from '../icons';
import type { Comparison, RenderContext, RenderedDocument } from '../renderers/types';
import { vscode } from '../vscodeApi';
import { OverviewRuler } from './overview';
import { BOTTOM, TOP } from './scrolling';

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
  /** The document shows the changes from another version itself, inline. */
  private inline = false;
  private peer: DocumentSummary | undefined;
  private target: Target | undefined;
  private comparison: Comparison | undefined;
  /** Bumped whenever the comparison is redone, so late async results are dropped. */
  private generation = 0;
  /** Change last moved to, for the status bar. */
  private position = -1;
  /** Scroll position set to follow the other side; its scroll event isn't passed back. */
  private following: number | undefined;
  private revealed = false;
  /** The zoom both sides last had, so taking on the other side's doesn't send it back. */
  private zoom: number | null | undefined;
  /** The last move between changes, which the next one waits for. */
  private moving: Promise<void> = Promise.resolve();
  private readonly cleanup: (() => void)[] = [];

  setSide(side: DiffSide | undefined): void {
    this.side = side;
    if (!side) {
      this.peer = undefined;
      this.zoom = undefined;
    }
    void this.publish();
    void this.update();
  }

  /** Shows the changes inline, in a document rendered with the version it is compared with. */
  setInline(inline: boolean): void {
    if (inline === this.inline) return;
    this.inline = inline;
    void this.update();
  }

  setPeer(summary: DocumentSummary): void {
    this.peer = summary;
    void this.update();
  }

  /** Takes over a document once it is on screen. */
  attach(document: RenderedDocument, context: RenderContext, strings: ViewerStrings): void {
    this.detach();
    this.target = { document, context, strings };
    void this.publish();
    void this.update();
  }

  /** Lets go of the document before it is replaced. */
  detach(): void {
    this.stop();
    this.target = undefined;
  }

  /** Selects what the other side selected. */
  async followSelection(selection: CellSelection): Promise<void> {
    await this.comparison?.select?.(selection);
  }

  /** Shares a zoom set on this side (a factor, or `null` for fitting the width). */
  zoomed(zoom: number | null): void {
    if (!this.side || zoom === this.zoom) return;
    this.zoom = zoom;
    vscode.postMessage({ type: 'zoomed', zoom });
  }

  /** Zooms like the other side, with `apply`, without sending that zoom back. */
  followZoom(zoom: number | null, apply: (zoom: number | null) => void): void {
    if (!this.side) return;
    this.zoom = zoom;
    apply(zoom);
  }

  /** Scrolls to where the other side is. */
  async follow(anchor: ScrollAnchor): Promise<void> {
    const { comparison, target } = this;
    if (!comparison || !target) return;
    await comparison.scrollTo(anchor);
    if (comparison === this.comparison) this.following = target.context.viewport.scrollTop;
  }

  private async publish(): Promise<void> {
    const target = this.target;
    if (!this.side || !target?.document.summary) return;
    const summary = await target.document.summary();
    if (target === this.target && this.side) vscode.postMessage({ type: 'summary', summary });
  }

  private async update(): Promise<void> {
    this.stop();
    const { side, peer, target } = this;
    if (!target || (!this.inline && (!side || !peer))) return;
    const generation = this.generation;
    const comparison = this.inline
      ? target.document.compareInline?.(target.context)
      : await target.document.compare?.(peer!, side!, target.context);
    if (generation !== this.generation) {
      comparison?.dispose();
      return;
    }
    this.comparison = comparison;
    if (!comparison) return;
    this.showBar(target);
    this.showOverview(target, comparison);
    this.listen(target.context.viewport);
    // Like VS Code's diff editor, open at the first change. The other side follows.
    if (
      (side === 'modified' || this.inline) &&
      !this.revealed &&
      target.context.viewport.scrollTop === 0
    ) {
      this.revealed = true;
      void this.go(1, false);
    }
  }

  private stop(): void {
    this.generation++;
    this.cleanup.splice(0).forEach((fn) => fn());
    this.comparison?.dispose();
    this.comparison = undefined;
    this.position = -1;
  }

  private showBar({ context, strings, document: shown }: Target): void {
    const bar = document.createElement('div');
    bar.className = 'ov-diff';
    bar.setAttribute('role', 'group');
    const button = (label: string, icon: string, direction: 1 | -1) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'ov-icon-button';
      element.innerHTML = icon;
      element.title = label;
      element.setAttribute('aria-label', label);
      element.addEventListener('click', () => void this.go(direction));
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
    if (shown.canShowInline) bar.append(this.layoutButton(strings));
    const { footer } = context;
    footer.append(bar);
    footer.hidden = false;
    this.renderStatus(status, strings);
    this.cleanup.push(() => {
      bar.remove();
      footer.hidden = footer.childElementCount === 0;
    });
  }

  /** Switches between the two sides and the changes inline, as VS Code's Inline View does. */
  private layoutButton(strings: ViewerStrings): HTMLElement {
    const inline = this.inline;
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'ov-icon-button ov-diff-layout';
    element.innerHTML = inline ? icons.sideBySide : icons.inline;
    const label = inline ? strings.sideBySideView : strings.inlineView;
    element.title = label;
    element.setAttribute('aria-label', label);
    element.addEventListener('click', () =>
      vscode.postMessage({ type: 'setInline', inline: !inline }),
    );
    return element;
  }

  /** The strip beside the scrollbar that shows where the changes are. */
  private showOverview({ context }: Target, comparison: Comparison): void {
    const { overview, goTo } = comparison;
    if (!overview || !goTo || comparison.count === 0) return;
    const ruler = new OverviewRuler(
      context.viewport,
      () => overview.call(comparison),
      (index) => void this.jump(index),
    );
    this.cleanup.push(() => ruler.dispose());
  }

  /** Goes to change `index`, picked on the overview ruler. */
  private jump(index: number): Promise<void> {
    const move = this.moving.then(async () => {
      const { comparison, target } = this;
      if (!comparison?.goTo || !target) return;
      await comparison.goTo(index);
      if (comparison !== this.comparison) return;
      this.position = index;
      const status = target.context.footer.querySelector<HTMLElement>('.ov-diff-status');
      if (status) this.renderStatus(status, target.strings);
    });
    this.moving = move.catch(() => undefined);
    return move;
  }

  private renderStatus(status: HTMLElement, strings: ViewerStrings): void {
    const count = this.comparison?.count ?? 0;
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
    const moves = status.parentElement?.querySelectorAll<HTMLButtonElement>(
      'button:not(.ov-diff-layout)',
    );
    for (const button of moves ?? []) {
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
      void this.go(event.shiftKey ? -1 : 1);
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
    const anchor = this.comparison?.anchor();
    if (!anchor) return;
    const max = viewport.scrollHeight - viewport.clientHeight;
    if (viewport.scrollTop <= 0) anchor.index = TOP;
    else if (viewport.scrollTop >= max - 1) anchor.index = BOTTOM;
    vscode.postMessage({ type: 'scroll', anchor });
  }

  /**
   * Moves to the next (1) or previous (-1) change, wrapping around at the ends. A move can take a
   * while (switching sheets), so moves run one after another and quick presses add up in order.
   */
  private go(direction: 1 | -1, announce = true): Promise<void> {
    const move = this.moving.then(() => this.step(direction, announce));
    this.moving = move.catch(() => undefined);
    return move;
  }

  private async step(direction: 1 | -1, announce: boolean): Promise<void> {
    const { comparison, target } = this;
    if (!comparison || !target || comparison.count === 0) return;
    const index = await comparison.go(direction);
    if (comparison !== this.comparison || index === undefined) return;
    this.position = index;
    const status = target.context.footer.querySelector<HTMLElement>('.ov-diff-status');
    if (status && announce) this.renderStatus(status, target.strings);
  }
}

import type {
  DiffSide,
  DocumentSummary,
  ScrollAnchor,
  ViewerCommand,
  WorkbookSummary,
} from '../../shared/protocol';
import { compareSheet, type SheetComparison } from '../diff/sheetCompare';
import { BOTTOM, TOP } from '../diff/scrolling';
import { FindBar } from '../findBar';
import { vscode } from '../vscodeApi';
import { columnName, SheetGrid } from '../xlsx/grid';
import type { SheetData, WorkbookInfo } from '../xlsx/model';
import { SheetTabs } from '../xlsx/sheetTabs';
import { buildStyleSheet, CellColors, gridColors } from '../xlsx/styleSheet';
import { WorkbookClient } from '../xlsx/workerClient';
import type { Comparison, RenderContext, RenderedDocument, RenderOptions, Renderer } from './types';

interface XlsxState {
  sheet: string;
  row: number;
  col: number;
}

export const xlsxRenderer: Renderer = {
  async render(data, target, options): Promise<RenderedDocument> {
    const client = new WorkbookClient();
    try {
      const info = await client.open(data, options.locale);
      const previous = options.previous as XlsxState | undefined;
      const remembered = previous
        ? info.sheets.findIndex((sheet) => sheet.name === previous.sheet && !sheet.hidden)
        : -1;
      const index = remembered >= 0 ? remembered : info.activeSheet;
      const sheet = await client.sheet(index);
      return new WorkbookView(
        client,
        info,
        index,
        sheet,
        target,
        options,
        remembered >= 0 ? previous : undefined,
      );
    } catch (error) {
      client.dispose();
      throw error;
    }
  },
};

class WorkbookView implements RenderedDocument {
  readonly naturalWidth = 0;
  private grid: SheetGrid;
  private readonly sheets = new Map<number, SheetData>();
  private readonly colors: CellColors;
  private readonly host: HTMLElement;
  private context: RenderContext | undefined;
  private tabs: SheetTabs | undefined;
  private status: HTMLElement | undefined;
  private readonly cleanup: (() => void)[] = [];
  private readonly numberFormat: Intl.NumberFormat;
  private find: FindBar | undefined;
  private matches: { row: number; col: number }[] = [];
  private matchIndex = -1;
  private values: Promise<WorkbookSummary> | undefined;
  /** Each sheet's differences from the other version, by name, when comparing. */
  private diff: Map<string, SheetComparison> | undefined;
  /** The change last moved to, and where the view was then. */
  private lastChange: { index: number; at: string } | undefined;

  constructor(
    private readonly client: WorkbookClient,
    private readonly info: WorkbookInfo,
    private index: number,
    sheet: SheetData,
    target: HTMLElement,
    private readonly options: RenderOptions,
    private readonly restore: XlsxState | undefined,
  ) {
    this.colors = new CellColors(options.palette);
    this.numberFormat = new Intl.NumberFormat(options.locale, { maximumFractionDigits: 6 });
    this.host = document.createElement('div');
    this.host.className = 'ng-host';
    const colors = gridColors(options.palette);
    this.host.style.cssText = [
      `--ng-sheet:${colors.sheet}`,
      `--ng-text:${colors.text}`,
      `--ng-grid:${colors.gridLine}`,
      `--ng-header-bg:${colors.headerBackground}`,
      `--ng-header-fg:${colors.headerText}`,
      `--ng-header-line:${colors.headerLine}`,
    ].join(';');
    const style = document.createElement('style');
    style.textContent = buildStyleSheet(info.styles, this.colors, '.ng-host');
    this.host.append(style);
    target.append(this.host);
    this.sheets.set(index, sheet);
    this.grid = this.createGrid(sheet);
    this.host.append(this.grid.element);
  }

  activate(context: RenderContext): void {
    this.context = context;
    const { viewport, footer } = context;

    const tabs = new SheetTabs(this.options.strings, {
      select: (index) => void this.showSheet(index),
      pickFromList: () => this.pickSheet(),
    });
    this.tabs = tabs;
    this.status = document.createElement('div');
    this.status.className = 'ov-status';
    this.status.setAttribute('aria-live', 'polite');
    footer.replaceChildren(tabs.element, this.status);
    footer.hidden = false;
    // Fill the area around a small sheet with the sheet color.
    viewport.style.background = gridColors(this.options.palette).sheet;
    this.renderTabs();

    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.grid.render());
    };
    const resize = new ResizeObserver(() => this.grid.render());
    resize.observe(viewport);
    const onMouseDown = (event: MouseEvent) => this.onMouseDown(event);
    const onKeyDown = (event: KeyboardEvent) => this.onKeyDown(event);
    const onCopy = (event: ClipboardEvent) => this.onCopy(event);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('mousedown', onMouseDown);
    viewport.addEventListener('keydown', onKeyDown);
    document.addEventListener('copy', onCopy);
    this.cleanup.push(() => {
      tabs.dispose();
      viewport.style.background = '';
      cancelAnimationFrame(frame);
      resize.disconnect();
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('mousedown', onMouseDown);
      viewport.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('copy', onCopy);
    });

    this.grid.render(true);
    if (this.restore) {
      this.grid.selectRange({
        row1: this.restore.row,
        col1: this.restore.col,
        row2: this.restore.row,
        col2: this.restore.col,
      });
    } else {
      this.grid.selectRange({ row1: 0, col1: 0, row2: 0, col2: 0 });
    }
  }

  refresh(): void {
    this.grid.render(true);
  }

  command(command: ViewerCommand): void {
    if (command === 'find') {
      this.openFind();
      return;
    }
    if (command === 'goToSheet') {
      this.pickSheet();
      return;
    }
    const visible = this.visibleSheets();
    const position = visible.indexOf(this.index);
    const next = command === 'nextSheet' ? position + 1 : position - 1;
    if (next >= 0 && next < visible.length) {
      void this.showSheet(visible[next]);
    }
  }

  goToSheet(name: string): void {
    const index = this.info.sheets.findIndex((sheet) => sheet.name === name && !sheet.hidden);
    if (index >= 0) void this.showSheet(index);
  }

  /** The displayed values of every visible sheet; the worker reads them all. */
  summary(): Promise<WorkbookSummary> {
    return (this.values ??= this.client.summary());
  }

  async compare(peer: DocumentSummary, side: DiffSide): Promise<Comparison | undefined> {
    if (peer.format !== 'xlsx') return undefined;
    const own = await this.summary();
    const theirs = new Map(peer.sheets.map((sheet) => [sheet.name, sheet.rows]));
    const diff = new Map(
      own.sheets.map((sheet) => [
        sheet.name,
        compareSheet(sheet.rows, theirs.get(sheet.name), side),
      ]),
    );
    this.diff = diff;
    this.grid.setMarks(diff.get(this.sheetName)?.marks);
    this.renderTabs();
    const changes = own.sheets.flatMap((sheet) =>
      (diff.get(sheet.name)?.changes ?? []).map((row) => ({ sheet: sheet.name, row })),
    );
    return {
      count: changes.length,
      go: (direction) => this.goToChange(changes, direction),
      anchor: () => this.scrollAnchor(),
      scrollTo: (anchor) => this.follow(anchor),
      dispose: () => {
        if (this.diff !== diff) return;
        this.diff = undefined;
        this.grid.setMarks(undefined);
        this.renderTabs();
      },
    };
  }

  state(): XlsxState {
    const active = this.grid.activeCell;
    return { sheet: this.info.sheets[this.index].name, row: active.row, col: active.col };
  }

  dispose(): void {
    this.cleanup.forEach((dispose) => dispose());
    this.find?.dispose();
    this.grid.dispose();
    this.client.dispose();
  }

  /** Searches the displayed values of the current sheet; Ctrl+F's own widget only sees drawn cells. */
  private openFind(): void {
    if (!this.context) return;
    this.find ??= new FindBar(
      this.context.overlay,
      {
        search: (query) => {
          this.matches = this.grid.findAll(query, this.options.locale);
          this.grid.setHighlights(this.matches);
          // Like Excel, start from the active cell.
          const active = this.grid.activeCell;
          const next = this.matches.findIndex(
            (m) => m.row > active.row || (m.row === active.row && m.col >= active.col),
          );
          this.matchIndex = (next < 0 ? 0 : next) - 1;
          return this.matches.length;
        },
        step: (direction) => {
          const count = this.matches.length;
          if (count === 0) return 0;
          this.matchIndex = (this.matchIndex + direction + count) % count;
          const match = this.matches[this.matchIndex];
          this.grid.select(match.row, match.col);
          return this.matchIndex + 1;
        },
        clear: () => {
          this.matches = [];
          this.grid.setHighlights(undefined);
        },
      },
      this.options.strings,
      () => this.context?.viewport.focus(),
    );
    this.find.open();
  }

  private get sheetName(): string {
    return this.info.sheets[this.index].name;
  }

  private async goToChange(
    changes: { sheet: string; row: number }[],
    direction: 1 | -1,
  ): Promise<number | undefined> {
    const viewport = this.context?.viewport;
    if (!viewport || changes.length === 0) return undefined;
    const at = () => `${this.sheetName}:${viewport.scrollTop}:${viewport.scrollLeft}`;
    let index: number;
    if (this.lastChange?.at === at()) {
      // Still where the last change was shown: step from it.
      index = (this.lastChange.index + direction + changes.length) % changes.length;
    } else {
      // Changes from the top row of the current sheet on are ahead.
      const order = this.visibleSheets().map((i) => this.info.sheets[i].name);
      const here = order.indexOf(this.sheetName);
      const top = this.grid.topRow().row;
      const ahead = ({ sheet, row }: { sheet: string; row: number }) =>
        order.indexOf(sheet) > here || (order.indexOf(sheet) === here && row >= top);
      index =
        direction > 0
          ? changes.findIndex(ahead)
          : changes.length - 1 - [...changes].reverse().findIndex((change) => !ahead(change));
      if (index < 0 || index >= changes.length) index = direction > 0 ? 0 : changes.length - 1;
    }
    const change = changes[index];
    await this.showSheet(this.info.sheets.findIndex((sheet) => sheet.name === change.sheet));
    this.grid.reveal(change.row, this.diff?.get(change.sheet)?.marks.cells.get(change.row)?.[0]);
    this.lastChange = { index, at: at() };
    return index;
  }

  /** Where this side is, in the other side's rows. */
  private scrollAnchor(): ScrollAnchor {
    const { row, fraction } = this.grid.topRow();
    const { col, fraction: columnFraction } = this.grid.leftColumn();
    const comparison = this.diff?.get(this.sheetName);
    return {
      sheet: this.sheetName,
      index: comparison ? comparison.toPeer(row) : row,
      fraction,
      column: col,
      columnFraction,
    };
  }

  /** Goes to where the other side is: its sheet, if this side has it, and its rows. */
  private async follow(anchor: ScrollAnchor): Promise<void> {
    const viewport = this.context?.viewport;
    if (!viewport) return;
    if (anchor.sheet !== undefined && anchor.sheet !== this.sheetName) {
      const index = this.info.sheets.findIndex(
        (sheet) => sheet.name === anchor.sheet && !sheet.hidden,
      );
      if (index < 0) return;
      await this.showSheet(index);
    }
    if (anchor.index === TOP) viewport.scrollTop = 0;
    else if (anchor.index === BOTTOM) viewport.scrollTop = viewport.scrollHeight;
    else this.grid.scrollToRow(anchor.index, anchor.fraction);
    if (anchor.column !== undefined) {
      this.grid.scrollToColumn(anchor.column, anchor.columnFraction ?? 0);
    }
  }

  private createGrid(sheet: SheetData): SheetGrid {
    const grid = this.newGrid(sheet);
    grid.setMarks(this.diff?.get(this.info.sheets[this.index].name)?.marks);
    return grid;
  }

  private newGrid(sheet: SheetData): SheetGrid {
    return new SheetGrid(sheet, {
      getViewport: () => this.context?.viewport ?? this.host,
      getZoom: () => this.context?.getZoom() ?? 1,
      styles: this.info.styles,
      colors: this.colors,
      chartLabels: { chart: this.options.strings.chart, hint: this.options.strings.chartHint },
      onSelectionChange: () => this.updateStatus(),
    });
  }

  private visibleSheets(): number[] {
    return this.info.sheets.flatMap((sheet, i) => (sheet.hidden ? [] : [i]));
  }

  private renderTabs(): void {
    this.tabs?.render(
      this.visibleSheets().map((index) => {
        const sheet = this.info.sheets[index];
        // When comparing, sheets with changes get a dot in the color of this side's changes.
        const comparison = this.diff?.get(sheet.name);
        return {
          index,
          name: sheet.name,
          color: sheet.tabColor && (this.colors.fill(sheet.tabColor) ?? sheet.tabColor),
          change: comparison?.changes.length ? comparison.marks.own : undefined,
        };
      }),
      this.index,
    );
  }

  /** Has VS Code list the sheets to pick from, for workbooks with more tabs than fit. */
  private pickSheet(): void {
    vscode.postMessage({
      type: 'pickSheet',
      sheets: this.visibleSheets().map((index) => {
        const { name } = this.info.sheets[index];
        return {
          name,
          current: index === this.index,
          changed: (this.diff?.get(name)?.changes.length ?? 0) > 0,
        };
      }),
    });
  }

  private async showSheet(index: number): Promise<void> {
    if (index === this.index || !this.context) return;
    this.index = index;
    this.renderTabs();
    let sheet = this.sheets.get(index);
    if (!sheet) {
      this.context.setBusy(true);
      try {
        sheet = await this.client.sheet(index);
        this.sheets.set(index, sheet);
      } catch (error) {
        console.error(error);
        return;
      } finally {
        this.context.setBusy(false);
      }
      if (this.index !== index) return;
    }
    const grid = this.createGrid(sheet);
    this.grid.element.replaceWith(grid.element);
    this.grid.dispose();
    this.grid = grid;
    this.context.viewport.scrollTo(0, 0);
    grid.render(true);
    grid.selectRange({ row1: 0, col1: 0, row2: 0, col2: 0 });
    this.find?.refresh();
    // Lets scroll listeners know the view changed even when it was already at the top, so
    // the other side of a comparison switches sheets too.
    this.context.viewport.dispatchEvent(new Event('scroll'));
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    const hit = this.grid.hitTest(event.clientX, event.clientY);
    const lastRow = this.grid.rowCount - 1;
    const lastCol = this.grid.colCount - 1;
    if (hit.row < 0 && hit.col < 0) {
      this.grid.selectRange({ row1: 0, col1: 0, row2: lastRow, col2: lastCol });
      return;
    }
    if (hit.row < 0) {
      this.grid.selectRange({ row1: 0, col1: hit.col, row2: lastRow, col2: hit.col });
      return;
    }
    if (hit.col < 0) {
      this.grid.selectRange({ row1: hit.row, col1: 0, row2: hit.row, col2: lastCol });
      return;
    }
    this.grid.select(hit.row, hit.col, event.shiftKey);
    const onMove = (move: MouseEvent) => {
      const over = this.grid.hitTest(move.clientX, move.clientY);
      const active = this.grid.activeCell;
      const row = Math.max(0, over.row);
      const col = Math.max(0, over.col);
      if (row !== active.row || col !== active.col) this.grid.select(row, col, true);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const { row, col } = this.grid.activeCell;
    const ctrl = event.ctrlKey || event.metaKey;
    const move = (r: number, c: number, extend = event.shiftKey) => {
      event.preventDefault();
      this.grid.select(r, c, extend);
    };
    switch (event.key) {
      case 'ArrowUp':
        return move(ctrl ? this.edge(row, col, -1, 0) : row - 1, col);
      case 'ArrowDown':
        return move(ctrl ? this.edge(row, col, 1, 0) : row + 1, col);
      case 'ArrowLeft':
        return move(row, ctrl ? this.edge(row, col, 0, -1) : col - 1);
      case 'ArrowRight':
        return move(row, ctrl ? this.edge(row, col, 0, 1) : col + 1);
      case 'PageUp':
        return move(row - this.grid.pageRows(), col);
      case 'PageDown':
        return move(row + this.grid.pageRows(), col);
      case 'Home':
        return move(ctrl ? 0 : row, 0);
      case 'Enter':
        return move(event.shiftKey ? row - 1 : row + 1, col, false);
      case 'Tab':
        return move(row, event.shiftKey ? col - 1 : col + 1, false);
      case 'a':
      case 'A':
        if (ctrl) {
          event.preventDefault();
          this.grid.selectRange({
            row1: 0,
            col1: 0,
            row2: this.grid.rowCount - 1,
            col2: this.grid.colCount - 1,
          });
        }
        return;
    }
  }

  /** Ctrl+Arrow: like Excel, jump to the edge of the current block of data. */
  private edge(row: number, col: number, dr: number, dc: number): number {
    const limit = dr ? this.grid.rowCount - 1 : this.grid.colCount - 1;
    const filled = (i: number) => (dr ? this.grid.textAt(i, col) : this.grid.textAt(row, i)) !== '';
    let i = dr ? row : col;
    const step = dr || dc;
    const inBlock = filled(i) && i + step >= 0 && i + step <= limit && filled(i + step);
    if (inBlock) {
      while (i + step >= 0 && i + step <= limit && filled(i + step)) i += step;
      return i;
    }
    i += step;
    while (i > 0 && i < limit && !filled(i)) i += step;
    return Math.max(0, Math.min(limit, i));
  }

  private onCopy(event: ClipboardEvent): void {
    if (!this.host.isConnected || !event.clipboardData) return;
    const range = this.grid.selection;
    // Whole-row and whole-column selections only copy as far as there is data.
    const lastRow = Math.max(range.row1, Math.min(range.row2, this.grid.lastDataRow));
    const lastCol = Math.max(range.col1, Math.min(range.col2, this.grid.lastDataCol));
    const lines: string[] = [];
    for (let r = range.row1; r <= lastRow; r++) {
      const cells: string[] = [];
      for (let c = range.col1; c <= lastCol; c++) cells.push(this.grid.textAt(r, c));
      lines.push(cells.join('\t'));
    }
    event.clipboardData.setData('text/plain', lines.join('\n'));
    event.preventDefault();
  }

  private updateStatus(): void {
    if (!this.status) return;
    const range = this.grid.selection;
    const single = range.row1 === range.row2 && range.col1 === range.col2;
    const address = single
      ? cellName(range.row1, range.col1)
      : `${cellName(range.row1, range.col1)}:${cellName(range.row2, range.col2)}`;
    const parts = [address];
    if (single) {
      const text = this.grid.textAt(range.row1, range.col1);
      if (text) parts.push(text.length > 80 ? `${text.slice(0, 80)}…` : text);
    } else {
      let count = 0;
      let numbers = 0;
      let sum = 0;
      this.grid.forEachCell(range, (r, c) => {
        count++;
        const value = this.grid.numberAt(r, c);
        if (!Number.isNaN(value)) {
          numbers++;
          sum += value;
        }
      });
      const { strings } = this.options;
      if (numbers > 0)
        parts.push(strings.statusAverage.replace('{0}', this.numberFormat.format(sum / numbers)));
      if (count > 1)
        parts.push(strings.statusCount.replace('{0}', this.numberFormat.format(count)));
      if (numbers > 0) parts.push(strings.statusSum.replace('{0}', this.numberFormat.format(sum)));
    }
    this.status.replaceChildren(
      ...parts.map((part) => {
        const span = document.createElement('span');
        span.textContent = part;
        return span;
      }),
    );
  }
}

function cellName(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

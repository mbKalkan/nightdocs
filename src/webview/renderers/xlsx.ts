import type { ViewerCommand } from '../../shared/protocol';
import { columnName, SheetGrid } from '../xlsx/grid';
import type { SheetData, WorkbookInfo } from '../xlsx/model';
import { buildStyleSheet, CellColors, gridColors } from '../xlsx/styleSheet';
import { WorkbookClient } from '../xlsx/workerClient';
import type { RenderContext, RenderedDocument, RenderOptions, Renderer } from './types';

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
  private tabs: HTMLElement | undefined;
  private status: HTMLElement | undefined;
  private readonly cleanup: (() => void)[] = [];
  private readonly numberFormat: Intl.NumberFormat;

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

    this.tabs = document.createElement('div');
    this.tabs.className = 'ov-sheet-tabs';
    this.tabs.setAttribute('role', 'tablist');
    this.status = document.createElement('div');
    this.status.className = 'ov-status';
    this.status.setAttribute('aria-live', 'polite');
    footer.replaceChildren(this.tabs, this.status);
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
    const visible = this.visibleSheets();
    const position = visible.indexOf(this.index);
    const next = command === 'nextSheet' ? position + 1 : position - 1;
    if (next >= 0 && next < visible.length) {
      void this.showSheet(visible[next]);
    }
  }

  state(): XlsxState {
    const active = this.grid.activeCell;
    return { sheet: this.info.sheets[this.index].name, row: active.row, col: active.col };
  }

  dispose(): void {
    this.cleanup.forEach((dispose) => dispose());
    this.client.dispose();
  }

  private createGrid(sheet: SheetData): SheetGrid {
    return new SheetGrid(sheet, {
      getViewport: () => this.context?.viewport ?? this.host,
      getZoom: () => this.context?.getZoom() ?? 1,
      styles: this.info.styles,
      colors: this.colors,
      onSelectionChange: () => this.updateStatus(),
    });
  }

  private visibleSheets(): number[] {
    return this.info.sheets.flatMap((sheet, i) => (sheet.hidden ? [] : [i]));
  }

  private renderTabs(): void {
    if (!this.tabs) return;
    this.tabs.replaceChildren(
      ...this.visibleSheets().map((i) => {
        const sheet = this.info.sheets[i];
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'ov-sheet-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(i === this.index));
        tab.textContent = sheet.name;
        tab.title = sheet.name;
        if (sheet.tabColor) {
          const color = this.colors.fill(sheet.tabColor) ?? sheet.tabColor;
          tab.style.setProperty('--tab-color', color);
          tab.classList.add('ov-sheet-tab-colored');
        }
        tab.addEventListener('click', () => void this.showSheet(i));
        return tab;
      }),
    );
    this.tabs
      .querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    this.grid = grid;
    this.context.viewport.scrollTo(0, 0);
    grid.render(true);
    grid.selectRange({ row1: 0, col1: 0, row2: 0, col2: 0 });
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

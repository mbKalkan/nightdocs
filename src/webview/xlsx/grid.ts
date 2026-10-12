import { CellKind, type CellStyle, type SheetData } from './model';
import type { CellColors } from './styleSheet';
import { fontStack } from './styleSheet';

const HEADER_HEIGHT = 20;
/** Extra pixels rendered around the visible area so small scrolls don't re-render. */
const OVERSCAN = 400;
/** Text spills into at most this many empty cells to its right, as in Excel. */
const MAX_OVERFLOW_COLS = 30;
const CELL_PADDING = 6;

export interface GridOptions {
  /** The scroll container; resolved lazily because the grid is built off-screen. */
  getViewport(): HTMLElement;
  getZoom(): number;
  styles: CellStyle[];
  colors: CellColors;
  onSelectionChange(): void;
}

export interface CellRange {
  row1: number;
  col1: number;
  row2: number;
  col2: number;
}

interface Window {
  row1: number;
  row2: number;
  col1: number;
  col2: number;
}

/**
 * A virtualized, read-only spreadsheet grid. Everything lives in one scroll container:
 * headers and frozen panes are `position: sticky` layers over the cell layer, so they stay
 * in sync with scrolling without any JavaScript on the scroll path.
 */
export class SheetGrid {
  readonly element: HTMLElement;
  private readonly layers: {
    main: HTMLElement;
    top: HTMLElement;
    left: HTMLElement;
    corner: HTMLElement;
  };
  private readonly colLeft: Float64Array;
  private readonly rowTop: Float64Array;
  private readonly headerWidth: number;
  private readonly frozenWidth: number;
  private readonly frozenHeight: number;
  private window: Window | undefined;
  private anchor = { row: 0, col: 0 };
  private focus = { row: 0, col: 0 };
  private readonly measure = document.createElement('canvas').getContext('2d');
  /** Last row and column holding a value, or -1 for an empty sheet. */
  readonly lastDataRow: number;
  readonly lastDataCol: number;

  constructor(
    private readonly sheet: SheetData,
    private readonly options: GridOptions,
  ) {
    this.colLeft = prefixSums(sheet.colWidths);
    this.rowTop = prefixSums(sheet.rowHeights);
    this.headerWidth = Math.max(34, String(sheet.rowCount).length * 8 + 14);
    this.frozenWidth = this.colLeft[Math.min(sheet.frozenCols, sheet.colCount)];
    this.frozenHeight = this.rowTop[Math.min(sheet.frozenRows, sheet.rowCount)];
    let lastRow = -1;
    let lastCol = -1;
    for (let r = 0; r < sheet.rowCount; r++) {
      for (let i = sheet.rowStarts[r]; i < sheet.rowStarts[r + 1]; i++) {
        if (sheet.cellKinds[i] !== CellKind.Empty) {
          lastRow = r;
          lastCol = Math.max(lastCol, sheet.cellCols[i]);
        }
      }
    }
    this.lastDataRow = lastRow;
    this.lastDataCol = lastCol;

    const width = this.headerWidth + this.colLeft[sheet.colCount];
    const height = HEADER_HEIGHT + this.rowTop[sheet.rowCount];
    const topHeight = HEADER_HEIGHT + this.frozenHeight;
    const leftWidth = this.headerWidth + this.frozenWidth;

    this.element = document.createElement('div');
    this.element.className = 'ng-canvas';
    this.element.classList.toggle('ng-no-lines', !sheet.showGridLines);
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;
    this.element.innerHTML = `
      <div class="ng-layer ng-main"></div>
      <div class="ng-layer ng-top" style="width:${width}px;height:${topHeight}px;margin-bottom:-${topHeight}px"></div>
      <div class="ng-layer ng-left" style="width:${leftWidth}px;height:${height}px;margin-bottom:-${height}px"></div>
      <div class="ng-layer ng-corner" style="width:${leftWidth}px;height:${topHeight}px"></div>`;
    const layer = (name: string) => this.element.querySelector(`.ng-${name}`) as HTMLElement;
    this.layers = {
      main: layer('main'),
      top: layer('top'),
      left: layer('left'),
      corner: layer('corner'),
    };
  }

  get selection(): CellRange {
    return {
      row1: Math.min(this.anchor.row, this.focus.row),
      col1: Math.min(this.anchor.col, this.focus.col),
      row2: Math.max(this.anchor.row, this.focus.row),
      col2: Math.max(this.anchor.col, this.focus.col),
    };
  }

  get activeCell(): { row: number; col: number } {
    return { ...this.focus };
  }

  /**
   * Renders the cells around the visible area; does nothing when that area is already
   * rendered. Returns whether it painted.
   */
  render(force = false): boolean {
    const needed = this.visibleWindow(0);
    const current = this.window;
    if (
      !force &&
      current &&
      needed.row1 >= current.row1 &&
      needed.row2 <= current.row2 &&
      needed.col1 >= current.col1 &&
      needed.col2 <= current.col2
    ) {
      return false;
    }
    this.window = this.visibleWindow(OVERSCAN);
    this.paint();
    return true;
  }

  select(row: number, col: number, extend = false): void {
    const r = clamp(row, 0, this.sheet.rowCount - 1);
    const c = clamp(col, 0, this.sheet.colCount - 1);
    this.focus = { row: r, col: c };
    if (!extend) this.anchor = { row: r, col: c };
    this.scrollIntoView(r, c);
    if (!this.render()) this.paint();
    this.options.onSelectionChange();
  }

  selectRange(range: CellRange): void {
    this.anchor = { row: range.row1, col: range.col1 };
    this.focus = { row: range.row2, col: range.col2 };
    this.paint();
    this.options.onSelectionChange();
  }

  /** Displayed text of a cell, '' when empty. */
  textAt(row: number, col: number): string {
    const index = this.cellIndex(row, col);
    return index < 0 ? '' : this.sheet.texts[this.sheet.cellTexts[index]];
  }

  numberAt(row: number, col: number): number {
    const index = this.cellIndex(row, col);
    return index < 0 || this.sheet.cellKinds[index] !== CellKind.Number
      ? NaN
      : this.sheet.cellNumbers[index];
  }

  /** Calls `visit` for every non-empty cell in the range. */
  forEachCell(range: CellRange, visit: (row: number, col: number, index: number) => void): void {
    const { rowStarts, cellCols, cellKinds } = this.sheet;
    for (let r = range.row1; r <= range.row2 && r < this.sheet.rowCount; r++) {
      for (let i = this.firstCellAtOrAfter(r, range.col1); i < rowStarts[r + 1]; i++) {
        if (cellCols[i] > range.col2) break;
        if (cellKinds[i] !== CellKind.Empty) visit(r, cellCols[i], i);
      }
    }
  }

  get rowCount(): number {
    return this.sheet.rowCount;
  }

  get colCount(): number {
    return this.sheet.colCount;
  }

  /** Rows that fit in the viewport, for Page Up/Down. */
  pageRows(): number {
    const height = this.options.getViewport().clientHeight / this.options.getZoom();
    const rowHeight = this.sheet.defaultRowHeight || 20;
    return Math.max(1, Math.floor((height - HEADER_HEIGHT - this.frozenHeight) / rowHeight) - 1);
  }

  /** Maps a pointer position to what is under it. */
  hitTest(clientX: number, clientY: number): { row: number; col: number } {
    const zoom = this.options.getZoom();
    const bounds = this.options.getViewport().getBoundingClientRect();
    const vx = (clientX - bounds.left) / zoom;
    const vy = (clientY - bounds.top) / zoom;
    const { scrollLeft, scrollTop } = this.options.getViewport();
    const x = vx < this.headerWidth + this.frozenWidth ? vx : vx + scrollLeft / zoom;
    const y = vy < HEADER_HEIGHT + this.frozenHeight ? vy : vy + scrollTop / zoom;
    // -1 marks the header row/column.
    const col = x < this.headerWidth ? -1 : indexAt(this.colLeft, x - this.headerWidth);
    const row = y < HEADER_HEIGHT ? -1 : indexAt(this.rowTop, y - HEADER_HEIGHT);
    return { row, col };
  }

  private scrollIntoView(row: number, col: number): void {
    const zoom = this.options.getZoom();
    const viewport = this.options.getViewport();
    const viewWidth = viewport.clientWidth / zoom;
    const viewHeight = viewport.clientHeight / zoom;
    let sx = viewport.scrollLeft / zoom;
    let sy = viewport.scrollTop / zoom;
    if (col >= this.sheet.frozenCols) {
      const x1 = this.headerWidth + this.colLeft[col];
      const x2 = this.headerWidth + this.colLeft[col + 1];
      if (x1 < sx + this.headerWidth + this.frozenWidth)
        sx = x1 - this.headerWidth - this.frozenWidth;
      else if (x2 > sx + viewWidth) sx = x2 - viewWidth;
    }
    if (row >= this.sheet.frozenRows) {
      const y1 = HEADER_HEIGHT + this.rowTop[row];
      const y2 = HEADER_HEIGHT + this.rowTop[row + 1];
      if (y1 < sy + HEADER_HEIGHT + this.frozenHeight) sy = y1 - HEADER_HEIGHT - this.frozenHeight;
      else if (y2 > sy + viewHeight) sy = y2 - viewHeight;
    }
    viewport.scrollLeft = Math.max(0, sx) * zoom;
    viewport.scrollTop = Math.max(0, sy) * zoom;
  }

  private visibleWindow(overscan: number): Window {
    const zoom = this.options.getZoom();
    const viewport = this.options.getViewport();
    const x1 = viewport.scrollLeft / zoom + this.frozenWidth - overscan;
    const x2 = (viewport.scrollLeft + viewport.clientWidth) / zoom - this.headerWidth + overscan;
    const y1 = viewport.scrollTop / zoom + this.frozenHeight - overscan;
    const y2 = (viewport.scrollTop + viewport.clientHeight) / zoom - HEADER_HEIGHT + overscan;
    return {
      col1: Math.max(this.sheet.frozenCols, indexAt(this.colLeft, Math.max(0, x1))),
      col2: Math.min(this.sheet.colCount - 1, indexAt(this.colLeft, Math.max(0, x2))),
      row1: Math.max(this.sheet.frozenRows, indexAt(this.rowTop, Math.max(0, y1))),
      row2: Math.min(this.sheet.rowCount - 1, indexAt(this.rowTop, Math.max(0, y2))),
    };
  }

  private paint(): void {
    const w = this.window;
    if (!w) return;
    const frozenRows = Math.min(this.sheet.frozenRows, this.sheet.rowCount);
    const frozenCols = Math.min(this.sheet.frozenCols, this.sheet.colCount);
    const selection = this.selectionHtml();
    const regionRows = { row1: w.row1, row2: w.row2 };
    const regionCols = { col1: w.col1, col2: w.col2 };
    const frozenRowRange = { row1: 0, row2: frozenRows - 1 };
    const frozenColRange = { col1: 0, col2: frozenCols - 1 };

    this.layers.main.innerHTML = this.region({ ...regionRows, ...regionCols }) + selection;
    this.layers.top.innerHTML =
      (frozenRows ? this.region({ ...frozenRowRange, ...regionCols }) : '') +
      selection +
      this.columnHeaders(w.col1, w.col2);
    this.layers.left.innerHTML =
      (frozenCols ? this.region({ ...regionRows, ...frozenColRange }) : '') +
      selection +
      this.rowHeaders(w.row1, w.row2);
    this.layers.corner.innerHTML =
      (frozenRows && frozenCols ? this.region({ ...frozenRowRange, ...frozenColRange }) : '') +
      selection +
      (frozenCols ? this.columnHeaders(0, frozenCols - 1) : '') +
      (frozenRows ? this.rowHeaders(0, frozenRows - 1) : '') +
      `<div class="ng-h ng-hx" style="left:0;top:0;width:${this.headerWidth}px;height:${HEADER_HEIGHT}px"></div>`;
  }

  /** Grid lines, merged cells and cells of a rectangular region, as HTML. */
  private region(range: CellRange): string {
    if (range.row2 < range.row1 || range.col2 < range.col1) return '';
    const { sheet, colLeft, rowTop, headerWidth } = this;
    const parts: string[] = [];
    const left = headerWidth + colLeft[range.col1];
    const right = headerWidth + colLeft[range.col2 + 1];
    const top = HEADER_HEIGHT + rowTop[range.row1];
    const bottom = HEADER_HEIGHT + rowTop[range.row2 + 1];

    for (let c = range.col1; c <= range.col2; c++) {
      if (sheet.colWidths[c] > 0) {
        parts.push(
          `<div class="ng-gv" style="left:${headerWidth + colLeft[c + 1] - 1}px;top:${top}px;height:${bottom - top}px"></div>`,
        );
      }
    }
    for (let r = range.row1; r <= range.row2; r++) {
      if (sheet.rowHeights[r] > 0) {
        parts.push(
          `<div class="ng-gh" style="left:${left}px;top:${HEADER_HEIGHT + rowTop[r + 1] - 1}px;width:${right - left}px"></div>`,
        );
      }
    }

    // Merged ranges touching this region: draw each once, and skip the cells they cover.
    const covered = new Set<number>();
    const merges = sheet.merges;
    for (let i = 0; i < merges.length; i += 4) {
      const [r1, c1, r2, c2] = [merges[i], merges[i + 1], merges[i + 2], merges[i + 3]];
      if (r2 < range.row1 || r1 > range.row2 || c2 < range.col1 || c1 > range.col2) continue;
      for (let r = Math.max(r1, range.row1); r <= Math.min(r2, range.row2); r++) {
        for (let c = Math.max(c1, range.col1); c <= Math.min(c2, range.col2); c++) {
          covered.add(r * 16384 + c);
        }
      }
      const width = colLeft[c2 + 1] - colLeft[c1];
      const height = rowTop[r2 + 1] - rowTop[r1];
      if (width > 0 && height > 0) {
        parts.push(this.cellHtml(r1, c1, this.cellIndex(r1, c1), width, height, true));
      }
    }

    for (let r = range.row1; r <= range.row2; r++) {
      if (sheet.rowHeights[r] === 0) continue;
      const end = sheet.rowStarts[r + 1];
      for (let i = this.firstCellAtOrAfter(r, range.col1); i < end; i++) {
        const c = sheet.cellCols[i];
        if (c > range.col2) break;
        if (sheet.colWidths[c] === 0 || covered.has(r * 16384 + c)) continue;
        if (sheet.cellKinds[i] === CellKind.Empty && !this.isDecorated(sheet.cellStyles[i]))
          continue;
        parts.push(this.cellHtml(r, c, i, sheet.colWidths[c], sheet.rowHeights[r], false));
      }
    }
    return parts.join('');
  }

  private cellHtml(
    row: number,
    col: number,
    index: number,
    width: number,
    height: number,
    merged: boolean,
  ): string {
    const { sheet } = this;
    const x = this.headerWidth + this.colLeft[col];
    const y = HEADER_HEIGHT + this.rowTop[row];
    if (index < 0) {
      return `<div class="ng-c ng-m" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px"></div>`;
    }
    const styleIndex = sheet.cellStyles[index];
    const style = this.options.styles[styleIndex];
    const kind = sheet.cellKinds[index];
    let text = sheet.texts[sheet.cellTexts[index]];
    let horizontal = style.horizontal;
    if (horizontal === 'general') {
      horizontal = kind === CellKind.Number ? 'right' : kind === CellKind.Text ? 'left' : 'center';
    }

    let drawWidth = width;
    const singleLine = !style.wrap && !merged;
    if (singleLine && text) {
      const textWidth = this.textWidth(text, style) + CELL_PADDING;
      if (textWidth > width) {
        if (kind === CellKind.Number) {
          // Excel shows #### when a number doesn't fit.
          text = '#'.repeat(
            Math.max(1, Math.floor((width - CELL_PADDING) / this.textWidth('#', style))),
          );
        } else if (kind === CellKind.Text && horizontal === 'left') {
          drawWidth = this.overflowWidth(row, col, index, textWidth);
        }
      }
    }

    const classes = [
      `ng-c s${styleIndex}`,
      `ng-h-${alignClass(horizontal)}`,
      `ng-v-${style.vertical === 'top' ? 't' : style.vertical === 'center' ? 'c' : 'b'}`,
    ];
    if (style.wrap) classes.push('ng-w');
    if (merged || drawWidth > width) classes.push('ng-m');
    const formatColor = this.options.colors.formatColor(sheet.cellFormatColors[index], style.fill);
    const color = formatColor ? `;color:${formatColor}` : '';
    return `<div class="${classes.join(' ')}" style="left:${x}px;top:${y}px;width:${drawWidth}px;height:${height}px${color}"><span>${escapeHtml(text)}</span></div>`;
  }

  /** Width covering the following empty cells that left-aligned text spills into. */
  private overflowWidth(row: number, col: number, index: number, needed: number): number {
    const { sheet } = this;
    let width = sheet.colWidths[col];
    const limit = Math.min(
      this.nextNonEmpty(row, index + 1),
      col + MAX_OVERFLOW_COLS,
      sheet.colCount,
    );
    for (let c = col + 1; c < limit && width < needed; c++) {
      if (this.isMerged(row, c)) break;
      width += sheet.colWidths[c];
    }
    return width;
  }

  private nextNonEmpty(row: number, from: number): number {
    const { sheet } = this;
    for (let i = from; i < sheet.rowStarts[row + 1]; i++) {
      if (sheet.cellKinds[i] !== CellKind.Empty) return sheet.cellCols[i];
    }
    return Infinity;
  }

  private isMerged(row: number, col: number): boolean {
    return this.mergeAt(row, col) !== undefined;
  }

  /** The merged range [row1, col1, row2, col2] containing a cell, if any. */
  mergeAt(row: number, col: number): [number, number, number, number] | undefined {
    const merges = this.sheet.merges;
    for (let i = 0; i < merges.length; i += 4) {
      if (
        row >= merges[i] &&
        row <= merges[i + 2] &&
        col >= merges[i + 1] &&
        col <= merges[i + 3]
      ) {
        return [merges[i], merges[i + 1], merges[i + 2], merges[i + 3]];
      }
    }
    return undefined;
  }

  private isDecorated(styleIndex: number): boolean {
    const style = this.options.styles[styleIndex];
    const border = style.border;
    return !!(style.fill || border.top || border.right || border.bottom || border.left);
  }

  private textWidth(text: string, style: CellStyle): number {
    if (!this.measure) return text.length * 7;
    this.measure.font = `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : ''}${style.size}pt ${fontStack(style.fontName)}`;
    return this.measure.measureText(text).width;
  }

  private columnHeaders(col1: number, col2: number): string {
    const sel = this.selection;
    const parts: string[] = [];
    for (let c = col1; c <= col2; c++) {
      const width = this.sheet.colWidths[c];
      if (width === 0) continue;
      const active = c >= sel.col1 && c <= sel.col2 ? ' ng-sel' : '';
      parts.push(
        `<div class="ng-h ng-hc${active}" style="left:${this.headerWidth + this.colLeft[c]}px;top:0;width:${width}px;height:${HEADER_HEIGHT}px">${columnName(c)}</div>`,
      );
    }
    return parts.join('');
  }

  private rowHeaders(row1: number, row2: number): string {
    const sel = this.selection;
    const parts: string[] = [];
    for (let r = row1; r <= row2; r++) {
      const height = this.sheet.rowHeights[r];
      if (height === 0) continue;
      const active = r >= sel.row1 && r <= sel.row2 ? ' ng-sel' : '';
      parts.push(
        `<div class="ng-h ng-hr${active}" style="left:0;top:${HEADER_HEIGHT + this.rowTop[r]}px;width:${this.headerWidth}px;height:${height}px">${r + 1}</div>`,
      );
    }
    return parts.join('');
  }

  private selectionHtml(): string {
    const sel = this.selection;
    const box = (r1: number, c1: number, r2: number, c2: number) => {
      const x = this.headerWidth + this.colLeft[c1];
      const y = HEADER_HEIGHT + this.rowTop[r1];
      return `left:${x}px;top:${y}px;width:${this.colLeft[c2 + 1] - this.colLeft[c1]}px;height:${this.rowTop[r2 + 1] - this.rowTop[r1]}px`;
    };
    // The active cell covers the whole merged range it belongs to, as in Excel.
    const merge = this.mergeAt(this.focus.row, this.focus.col) ?? [
      this.focus.row,
      this.focus.col,
      this.focus.row,
      this.focus.col,
    ];
    const single =
      sel.row1 === merge[0] &&
      sel.col1 === merge[1] &&
      sel.row2 <= merge[2] &&
      sel.col2 <= merge[3];
    const range = single
      ? ''
      : `<div class="ng-range" style="${box(sel.row1, sel.col1, sel.row2, sel.col2)}"></div>`;
    const active = `<div class="ng-active" style="${box(merge[0], merge[1], merge[2], merge[3])}"></div>`;
    return range + active;
  }

  private cellIndex(row: number, col: number): number {
    if (row < 0 || row >= this.sheet.rowCount) return -1;
    const i = this.firstCellAtOrAfter(row, col);
    return i < this.sheet.rowStarts[row + 1] && this.sheet.cellCols[i] === col ? i : -1;
  }

  /** Index of the first cell in `row` whose column is >= `col` (binary search). */
  private firstCellAtOrAfter(row: number, col: number): number {
    const { rowStarts, cellCols } = this.sheet;
    let low = rowStarts[row];
    let high = rowStarts[row + 1];
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (cellCols[mid] < col) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}

export function columnName(col: number): string {
  let name = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function alignClass(horizontal: string): string {
  switch (horizontal) {
    case 'center':
    case 'centerContinuous':
      return 'c';
    case 'right':
      return 'r';
    case 'justify':
    case 'distributed':
      return 'j';
    default:
      return 'l';
  }
}

function prefixSums(sizes: Float32Array): Float64Array {
  const sums = new Float64Array(sizes.length + 1);
  for (let i = 0; i < sizes.length; i++) sums[i + 1] = sums[i] + sizes[i];
  return sums;
}

/** Index of the row/column containing `offset` in a prefix-sum array. */
function indexAt(sums: Float64Array, offset: number): number {
  let low = 0;
  let high = sums.length - 2;
  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if (sums[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

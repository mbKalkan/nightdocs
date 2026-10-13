import { CELL_SEPARATOR, type DiffSide } from '../../shared/protocol';
import { align, type Alignment } from './align';
import { otherChange, ownChange } from './marks';

/** What to mark in one version of a sheet. */
export interface SheetMarks {
  /** `removed` on the original side, `added` on the modified side. */
  own: 'added' | 'removed';
  /** The other side's: the color of gaps. */
  other: 'added' | 'removed';
  /** Rows only this side has. */
  rows: Set<number>;
  /** Columns only this side has. */
  cols: Set<number>;
  /** Columns that differ in rows both sides have, by row. */
  cells: Map<number, number[]>;
  /** Rows above which the other side has rows this one doesn't; the row count means "below the last row". */
  gaps: Set<number>;
  /** Columns left of which the other side has columns this one doesn't; the column count means "right of the last". */
  colGaps: Set<number>;
}

/** Where a change starts: a run of changed rows, or a column only one side has. */
export interface SheetChange {
  row: number;
  col?: number;
}

export interface SheetComparison {
  marks: SheetMarks;
  /** The other side has no sheet by this name. */
  onlyHere: boolean;
  /** Each change, top to bottom; changed columns come first, at the top. */
  changes: SheetChange[];
  /** The row of the other side at the same place as a row of this side. */
  toPeer(row: number): number;
  /** The column of the other side at the same place as a column of this side. */
  toPeerColumn(col: number): number;
}

/**
 * Compares two versions of a sheet. Columns are lined up first and rows next, on the columns
 * both sides have, so an inserted or deleted column or row doesn't make everything after it
 * look changed; then the cells of rows both sides have are compared.
 */
export function compareSheet(
  own: readonly string[],
  peer: readonly string[] | undefined,
  side: DiffSide,
): SheetComparison {
  const marks: SheetMarks = {
    own: ownChange(side),
    other: otherChange(side),
    rows: new Set(),
    cols: new Set(),
    cells: new Map(),
    gaps: new Set(),
    colGaps: new Set(),
  };
  // A sheet only this side has is one change: all of it.
  if (!peer) {
    own.forEach((row, index) => row && marks.rows.add(index));
    const first = own.findIndex((row) => row !== '');
    return {
      marks,
      onlyHere: true,
      changes: first < 0 ? [] : [{ row: first }],
      toPeer: () => 0,
      toPeerColumn: () => 0,
    };
  }

  const original = side === 'original';
  const ownCells = own.map((row) => row.split(CELL_SEPARATOR));
  const peerCells = peer.map((row) => row.split(CELL_SEPARATOR));
  const ownWidth = widthOf(ownCells);
  const peerWidth = widthOf(peerCells);

  const columns = matchItems(alignColumns(ownCells, peerCells, original), original);
  for (const col of columns.onlyHere) marks.cols.add(col);
  for (const col of columns.gaps) marks.colGaps.add(col);
  // Columns edited in place show in their cells; only added and removed ones are changes here.
  const changes: SheetChange[] = columns.structural.map((col) => ({ row: 0, col }));

  // Rows line up by the columns both sides have, in the same order on both.
  const shared: number[] = [];
  for (let col = 0; col < ownWidth; col++) if (!marks.cols.has(col)) shared.push(col);
  const peerShared = shared.map((col) => columns.toPeer[col]);
  const ownKeys = ownCells.map((cells) => rowKey(cells, shared));
  const peerKeys = peerCells.map((cells) => rowKey(cells, peerShared));
  const rows = matchItems(
    original
      ? align(ownKeys, peerKeys, { inPlace: 'all' })
      : align(peerKeys, ownKeys, { inPlace: 'all' }),
    original,
  );
  for (const row of rows.onlyHere) marks.rows.add(row);
  for (const row of rows.gaps) marks.gaps.add(row);
  for (const [row, counterpart] of rows.edited) {
    const changed = shared.filter(
      (col, i) => (ownCells[row][col] ?? '') !== (peerCells[counterpart][peerShared[i]] ?? ''),
    );
    if (changed.length > 0) marks.cells.set(row, changed);
  }
  changes.push(...rows.starts.map((row) => ({ row })));

  return {
    marks,
    onlyHere: false,
    changes,
    toPeer: (row) =>
      row < rows.toPeer.length
        ? rows.toPeer[row]
        : // Below the last row with values, both sides go on in step.
          Math.max(0, row - own.length + peer.length),
    toPeerColumn: (col) =>
      col < columns.toPeer.length ? columns.toPeer[col] : Math.max(0, col - ownWidth + peerWidth),
  };
}

/** How the items of this side match the other side's, from an alignment of the two. */
interface Matching {
  /** Items edited between the versions: this side's index to the other side's. */
  edited: Map<number, number>;
  /** Items only this side has. */
  onlyHere: number[];
  /** Places before which the other side has items this side doesn't; the length means "after the last". */
  gaps: number[];
  /** The first place of each run of changes. */
  starts: number[];
  /**
   * For each run where one side has items the other lacks, the first such item on this side
   * or, if only the other side has some, where they would be.
   */
  structural: number[];
  /** For each item, the other side's item at the same place. */
  toPeer: number[];
}

function matchItems(alignment: Alignment, original: boolean): Matching {
  const matching: Matching = {
    edited: new Map(),
    onlyHere: [],
    gaps: [],
    starts: [],
    structural: [],
    toPeer: original ? alignment.aToB : alignment.bToA,
  };
  for (const hunk of alignment.hunks) {
    const [start, end] = original ? [hunk.aStart, hunk.aEnd] : [hunk.bStart, hunk.bEnd];
    const [otherStart, otherEnd] = original ? [hunk.bStart, hunk.bEnd] : [hunk.aStart, hunk.aEnd];
    const pairs = hunk.pairs.map(([a, b]) => (original ? [a, b] : [b, a]));
    const toOther = new Map(pairs as [number, number][]);
    const toOwn = new Map(pairs.map(([mine, theirs]) => [theirs, mine]));
    let firstOnlyHere: number | undefined;
    for (let item = start; item < end; item++) {
      const counterpart = toOther.get(item);
      if (counterpart === undefined) {
        matching.onlyHere.push(item);
        firstOnlyHere ??= item;
      } else {
        matching.edited.set(item, counterpart);
      }
    }
    // Items only the other side has are marked by a line where they would be on this side.
    let at = start;
    let firstGap: number | undefined;
    for (let item = otherStart; item < otherEnd; item++) {
      const mine = toOwn.get(item);
      if (mine === undefined) {
        if (matching.gaps[matching.gaps.length - 1] !== at) matching.gaps.push(at);
        firstGap ??= at;
      } else {
        at = mine + 1;
      }
    }
    matching.starts.push(start);
    const structural = firstOnlyHere ?? firstGap;
    if (structural !== undefined) matching.structural.push(structural);
  }
  return matching;
}

/**
 * Lines up the columns of two versions: equal columns match, and in a run of changed ones,
 * columns with mostly the same values are the same column edited, so rows added on one side
 * still match. As many columns changed as replaced them are taken to be edited in place.
 */
function alignColumns(
  own: readonly string[][],
  peer: readonly string[][],
  original: boolean,
): Alignment {
  const [a, b] = original ? [own, peer] : [peer, own];
  const aColumns = columnsOf(a);
  const bColumns = columnsOf(b);
  return align(
    aColumns.map((column) => column.key),
    bColumns.map((column) => column.key),
    { inPlace: 'always', score: (x, y) => overlap(aColumns[x].values(), bColumns[y].values()) },
  );
}

/** Values compared per column; enough to tell columns apart without reading huge sheets twice. */
const COLUMN_SAMPLE = 5000;

function columnsOf(rows: readonly string[][]): { key: string; values(): Set<string> }[] {
  return Array.from({ length: widthOf(rows) }, (_, col) => {
    let values: Set<string> | undefined;
    return {
      key: rows.map((cells) => cells[col] ?? '').join('\n'),
      values: () => {
        if (!values) {
          values = new Set();
          for (const cells of rows) {
            if (cells[col]) values.add(cells[col]);
            if (values.size >= COLUMN_SAMPLE) break;
          }
        }
        return values;
      },
    };
  });
}

/** Share of values two columns have in common (Jaccard index). */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return a.size === b.size ? 1 : 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let common = 0;
  for (const value of small) if (large.has(value)) common++;
  return common / (a.size + b.size - common);
}

function rowKey(cells: readonly string[], columns: readonly number[]): string {
  let last = columns.length - 1;
  while (last >= 0 && !cells[columns[last]]) last--;
  return columns
    .slice(0, last + 1)
    .map((col) => cells[col] ?? '')
    .join(CELL_SEPARATOR);
}

function widthOf(rows: readonly string[][]): number {
  let width = 0;
  for (const cells of rows) width = Math.max(width, cells.length);
  return width;
}

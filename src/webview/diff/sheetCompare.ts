import { CELL_SEPARATOR, type DiffSide } from '../../shared/protocol';
import { align } from './align';
import { otherChange, ownChange } from './marks';

/** What to mark in one version of a sheet. */
export interface SheetMarks {
  /** `removed` on the original side, `added` on the modified side. */
  own: 'added' | 'removed';
  /** The other side's: the color of gaps. */
  other: 'added' | 'removed';
  /** Rows only this side has. */
  rows: Set<number>;
  /** Columns that differ in rows both sides have, by row. */
  cells: Map<number, number[]>;
  /** Rows above which the other side has rows this one doesn't; the row count means "below the last row". */
  gaps: Set<number>;
}

export interface SheetComparison {
  marks: SheetMarks;
  /** The other side has no sheet by this name. */
  onlyHere: boolean;
  /** The first row of each change, top to bottom. */
  changes: number[];
  /** The row of the other side at the same place as a row of this side. */
  toPeer(row: number): number;
}

/**
 * Compares the rows of two versions of a sheet: rows are lined up first, so inserted and
 * deleted rows don't make every row below them look changed, then the cells of rows both
 * sides have are compared column by column.
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
    cells: new Map(),
    gaps: new Set(),
  };
  // A sheet only this side has is one change: all of it.
  if (!peer) {
    own.forEach((row, index) => row && marks.rows.add(index));
    const first = own.findIndex((row) => row !== '');
    return { marks, onlyHere: true, changes: first < 0 ? [] : [first], toPeer: () => 0 };
  }

  const original = side === 'original';
  const alignment = original
    ? align(own, peer, { inPlace: 'all' })
    : align(peer, own, { inPlace: 'all' });
  const ownToPeer = original ? alignment.aToB : alignment.bToA;
  const changes: number[] = [];
  for (const hunk of alignment.hunks) {
    const [start, end] = original ? [hunk.aStart, hunk.aEnd] : [hunk.bStart, hunk.bEnd];
    const edited = new Map(hunk.pairs.map(([a, b]) => (original ? [a, b] : [b, a])));
    for (let row = start; row < end; row++) {
      const counterpart = edited.get(row);
      if (counterpart === undefined) {
        marks.rows.add(row);
      } else {
        const columns = changedColumns(own[row], peer[counterpart]);
        if (columns.length > 0) marks.cells.set(row, columns);
      }
    }
    // Rows only the other side has are marked by a line where they would be on this side.
    const [otherStart, otherEnd] = original ? [hunk.bStart, hunk.bEnd] : [hunk.aStart, hunk.aEnd];
    const toOwn = new Map(hunk.pairs.map(([a, b]) => (original ? [b, a] : [a, b])));
    let at = start;
    for (let row = otherStart; row < otherEnd; row++) {
      const mine = toOwn.get(row);
      if (mine === undefined) marks.gaps.add(at);
      else at = mine + 1;
    }
    changes.push(start);
  }

  return {
    marks,
    onlyHere: false,
    changes,
    toPeer: (row) =>
      row < ownToPeer.length
        ? ownToPeer[row]
        : // Below the last row with values, both sides go on in step.
          Math.max(0, row - own.length + peer.length),
  };
}

function changedColumns(mine: string, theirs: string): number[] {
  const a = mine.split(CELL_SEPARATOR);
  const b = theirs.split(CELL_SEPARATOR);
  const columns: number[] = [];
  for (let col = 0; col < Math.max(a.length, b.length); col++) {
    if ((a[col] ?? '') !== (b[col] ?? '')) columns.push(col);
  }
  return columns;
}

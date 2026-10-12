import type { CellRange } from './model';

/** "AB12" → { row: 11, col: 27 } (0-based). */
export function parseCellRef(ref: string): { row: number; col: number } | undefined {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  if (!match) return undefined;
  let col = 0;
  for (const char of match[1].toUpperCase()) {
    col = col * 26 + (char.charCodeAt(0) - 64);
  }
  return { row: parseInt(match[2], 10) - 1, col: col - 1 };
}

/** "A1:C5" or "B2" → an inclusive, 0-based range. */
export function parseRange(ref: string): CellRange | undefined {
  const [first, last = first] = ref.split(':');
  const from = parseCellRef(first);
  const to = parseCellRef(last);
  if (!from || !to) return undefined;
  return {
    row1: Math.min(from.row, to.row),
    col1: Math.min(from.col, to.col),
    row2: Math.max(from.row, to.row),
    col2: Math.max(from.col, to.col),
  };
}

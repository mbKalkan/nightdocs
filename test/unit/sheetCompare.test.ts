import { describe, expect, it } from 'vitest';
import { CELL_SEPARATOR } from '../../src/shared/protocol';
import { compareSheet } from '../../src/webview/diff/sheetCompare';
import { CellKind, type SheetData } from '../../src/webview/xlsx/model';
import { sheetRows } from '../../src/webview/xlsx/summary';

const row = (...cells: (string | number)[]) => cells.join(CELL_SEPARATOR);

describe('compareSheet', () => {
  const original = [
    row('Order', 'Qty', 'Price'),
    row('SO-1', 2, 40),
    row('SO-2', 5, 90),
    row('SO-3', 1, 60),
    row('SO-4', 3, 70),
  ];
  const revised = [
    row('Order', 'Qty', 'Price'),
    row('SO-1', 4, 40),
    row('SO-3', 1, 60),
    row('SO-9', 7, 10),
    row('SO-4', 3, 70),
    row('SO-5', 2, 50),
  ];

  it('marks removed rows and changed cells on the original side', () => {
    const { marks, changes } = compareSheet(original, revised, 'original');
    expect(marks.own).toBe('removed');
    expect([...marks.rows]).toEqual([2]);
    expect([...marks.cells]).toEqual([[1, [1]]]);
    // SO-9 and SO-5 were added: lines above row 4 and below the last row.
    expect([...marks.gaps]).toEqual([4, 5]);
    expect(changes).toEqual([{ row: 1 }, { row: 4 }, { row: 5 }]);
  });

  it('marks added rows and changed cells on the modified side', () => {
    const { marks, changes } = compareSheet(revised, original, 'modified');
    expect(marks.own).toBe('added');
    expect([...marks.rows]).toEqual([3, 5]);
    expect([...marks.cells]).toEqual([[1, [1]]]);
    // SO-2 was removed: a line above SO-3.
    expect([...marks.gaps]).toEqual([2]);
    expect(changes).toEqual([{ row: 1 }, { row: 3 }, { row: 5 }]);
  });

  it('lines rows up for scrolling together', () => {
    const { toPeer } = compareSheet(original, revised, 'original');
    expect([0, 1, 3, 4].map(toPeer)).toEqual([0, 1, 2, 4]);
    // Below the last row with values, both sides go on in step.
    expect(toPeer(10)).toBe(11);
  });

  it('marks a sheet the other side lacks as one change', () => {
    const { marks, changes, onlyHere } = compareSheet(
      ['', row('Note'), '', row('More')],
      undefined,
      'modified',
    );
    expect(onlyHere).toBe(true);
    expect([...marks.rows]).toEqual([1, 3]);
    expect(changes).toEqual([{ row: 1 }]);
  });

  it('finds no changes between equal sheets', () => {
    const { marks, changes } = compareSheet(original, [...original], 'modified');
    expect(changes).toEqual([]);
    expect(marks.rows.size + marks.cells.size + marks.gaps.size).toBe(0);
    expect(marks.cols.size + marks.colGaps.size).toBe(0);
  });

  describe('with a column inserted', () => {
    // A Discount column between Qty and Price, one price changed and a row added.
    const withDiscount = [
      row('Order', 'Qty', 'Discount', 'Price'),
      row('SO-1', 2, '5%', 40),
      row('SO-2', 5, '0%', 95),
      row('SO-3', 1, '10%', 60),
      row('SO-4', 3, '0%', 70),
      row('SO-5', 2, '0%', 50),
    ];

    it('marks the column, not every cell right of it', () => {
      const { marks, changes } = compareSheet(withDiscount, original, 'modified');
      expect([...marks.cols]).toEqual([2]);
      expect([...marks.cells]).toEqual([[2, [3]]]);
      expect([...marks.rows]).toEqual([5]);
      expect(changes).toEqual([{ row: 0, col: 2 }, { row: 2 }, { row: 5 }]);
    });

    it('marks where the column would be on the other side', () => {
      const { marks, changes } = compareSheet(original, withDiscount, 'original');
      expect(marks.cols.size).toBe(0);
      expect([...marks.colGaps]).toEqual([2]);
      expect([...marks.cells]).toEqual([[2, [2]]]);
      expect([...marks.gaps]).toEqual([5]);
      // The same changes as the other side, so moving between them stays in step.
      expect(changes).toEqual([{ row: 0, col: 2 }, { row: 2 }, { row: 5 }]);
    });

    it('lines columns up for scrolling and selecting together', () => {
      const modified = compareSheet(withDiscount, original, 'modified');
      expect([0, 1, 3, 9].map(modified.toPeerColumn)).toEqual([0, 1, 2, 8]);
      const originalSide = compareSheet(original, withDiscount, 'original');
      expect([0, 1, 2].map(originalSide.toPeerColumn)).toEqual([0, 1, 3]);
    });
  });

  it('marks a removed column and its gap at the right edge', () => {
    const narrow = original.map((line) =>
      line.split(CELL_SEPARATOR).slice(0, 2).join(CELL_SEPARATOR),
    );
    const removed = compareSheet(original, narrow, 'original');
    expect([...removed.marks.cols]).toEqual([2]);
    expect(removed.marks.cells.size + removed.marks.rows.size).toBe(0);
    const added = compareSheet(narrow, original, 'modified');
    expect([...added.marks.colGaps]).toEqual([2]);
  });

  it('keeps columns in place when as many changed as replaced them', () => {
    const renamed = original.map((line, i) => (i === 0 ? row('Order', 'Units', 'Cost') : line));
    const { marks } = compareSheet(renamed, original, 'modified');
    expect(marks.cols.size + marks.colGaps.size).toBe(0);
    expect([...marks.cells]).toEqual([[0, [1, 2]]]);
  });
});

describe('sheetRows', () => {
  /** A sheet from rows of [column, text] cells, the way the parser lays one out. */
  function sheet(rows: [number, string][][]): SheetData {
    const texts: string[] = [];
    const rowStarts = [0];
    const cellCols: number[] = [];
    const cellKinds: number[] = [];
    const cellTexts: number[] = [];
    for (const cells of rows) {
      for (const [col, text] of cells) {
        cellCols.push(col);
        cellKinds.push(text ? CellKind.Text : CellKind.Empty);
        cellTexts.push(texts.push(text) - 1);
      }
      rowStarts.push(cellCols.length);
    }
    return {
      rowCount: rows.length,
      rowStarts: Uint32Array.from(rowStarts),
      cellCols: Uint16Array.from(cellCols),
      cellKinds: Uint8Array.from(cellKinds),
      cellTexts: Uint32Array.from(cellTexts),
      texts,
    } as unknown as SheetData;
  }

  it('puts each value at its column and leaves out formatting-only rows at the end', () => {
    const rows = sheetRows(
      sheet([
        [
          [0, 'Order'],
          [2, 'Price'],
        ],
        [],
        [[1, 'only B']],
        [[3, '']],
        [],
      ]),
    );
    expect(rows).toEqual([row('Order', '', 'Price'), '', row('', 'only B')]);
  });
});

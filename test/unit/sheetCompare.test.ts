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
    expect(changes).toEqual([1, 4, 5]);
  });

  it('marks added rows and changed cells on the modified side', () => {
    const { marks, changes } = compareSheet(revised, original, 'modified');
    expect(marks.own).toBe('added');
    expect([...marks.rows]).toEqual([3, 5]);
    expect([...marks.cells]).toEqual([[1, [1]]]);
    // SO-2 was removed: a line above SO-3.
    expect([...marks.gaps]).toEqual([2]);
    expect(changes).toEqual([1, 3, 5]);
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
    expect(changes).toEqual([1]);
  });

  it('finds no changes between equal sheets', () => {
    const { marks, changes } = compareSheet(original, [...original], 'modified');
    expect(changes).toEqual([]);
    expect(marks.rows.size + marks.cells.size + marks.gaps.size).toBe(0);
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

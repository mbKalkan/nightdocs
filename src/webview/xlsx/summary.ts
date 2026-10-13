import { CELL_SEPARATOR } from '../../shared/protocol';
import { CellKind, type SheetData } from './model';

/**
 * Each row's displayed values at their column positions, for comparing two versions of a
 * sheet. Rows that only hold formatting at the end are left out.
 */
export function sheetRows(sheet: SheetData): string[] {
  const rows: string[] = [];
  for (let r = 0; r < sheet.rowCount; r++) {
    const cells: string[] = [];
    for (let i = sheet.rowStarts[r]; i < sheet.rowStarts[r + 1]; i++) {
      const text = sheet.cellKinds[i] === CellKind.Empty ? '' : sheet.texts[sheet.cellTexts[i]];
      if (text) cells[sheet.cellCols[i]] = text;
    }
    rows.push(Array.from(cells, (text) => text ?? '').join(CELL_SEPARATOR));
  }
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}

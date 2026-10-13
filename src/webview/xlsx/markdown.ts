/** A cell as copied: its displayed text, and whether it holds a number. */
export interface CopiedCell {
  text: string;
  number: boolean;
}

/**
 * Cells as a Markdown table, the first row as its header. Columns of numbers are aligned right,
 * as Excel shows them; pipes are escaped and line breaks kept as `<br>`.
 */
export function markdownTable(rows: readonly (readonly CopiedCell[])[]): string {
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const body = rows.slice(1);
  const numeric = Array.from({ length: width }, (_, col) => {
    const filled = body.map((row) => row[col]).filter((cell) => cell?.text);
    return filled.length > 0 && filled.every((cell) => cell.number);
  });
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const texts = (row: readonly CopiedCell[]) =>
    Array.from({ length: width }, (_, col) => escapeCell(row[col]?.text ?? ''));
  return [
    line(texts(rows[0])),
    line(numeric.map((right) => (right ? '---:' : '---'))),
    ...body.map((row) => line(texts(row))),
  ].join('\n');
}

function escapeCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateConditionalFormats, parseDxfs } from '../../src/webview/xlsx/conditional';
import { readThemeColors } from '../../src/webview/xlsx/excelColors';
import type { CellStyle } from '../../src/webview/xlsx/model';
import { openWorkbook, parseSheet } from '../../src/webview/xlsx/parse';
import { parseCellRef } from '../../src/webview/xlsx/refs';

const theme = readThemeColors(undefined);
const dxfs = parseDxfs(
  '<styleSheet><dxfs count="2">' +
    '<dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>' +
    '<dxf><font><b/><i val="0"/></font></dxf>' +
    '</dxfs></styleSheet>',
  theme,
);
const RED = { color: '#9c0006', fill: '#ffc7ce' };
const BOLD = { bold: true, italic: false };

const style: CellStyle = {
  bold: false,
  italic: false,
  underline: 'none',
  strike: false,
  size: 11,
  fontName: 'Calibri',
  border: {},
  horizontal: 'general',
  vertical: 'bottom',
  wrap: false,
  indent: 0,
};

/** Puts `values` in A1, A2, … and returns what the rules give each of those cells. */
function evaluate(values: (number | string)[], ...rules: [sqref: string, rule: string][]) {
  const rows = values
    .map((value, i) =>
      typeof value === 'number'
        ? `<row r="${i + 1}"><c r="A${i + 1}"><v>${value}</v></c></row>`
        : `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${value}</t></is></c></row>`,
    )
    .join('');
  const blocks = rules
    .map(
      ([sqref, rule]) => `<conditionalFormatting sqref="${sqref}">${rule}</conditionalFormatting>`,
    )
    .join('');
  const xml = `<worksheet><sheetData>${rows}</sheetData>${blocks}</worksheet>`;
  const sheet = parseSheet(xml, {
    sharedStrings: [],
    styles: [style],
    formats: ['General'],
    date1904: false,
  });
  const result = evaluateConditionalFormats(xml, sheet, dxfs, theme);
  return values.map((_, row) => result.get(sheet.rowStarts[row]));
}

const cellIs = (operator: string, ...formulas: string[]) =>
  `<cfRule type="cellIs" dxfId="0" priority="1" operator="${operator}">${formulas
    .map((f) => `<formula>${f}</formula>`)
    .join('')}</cfRule>`;

describe('parseDxfs', () => {
  it('reads colors, fills and explicit on/off flags', () => {
    expect(dxfs).toEqual([RED, BOLD]);
  });
});

describe('conditional formatting', () => {
  it('compares cell values with numbers and text like Excel', () => {
    expect(evaluate([3, -5, 0, 'text'], ['A1:A4', cellIs('lessThan', '0')])).toEqual([
      undefined,
      RED,
      undefined,
      undefined,
    ]);
    // Text sorts after numbers, and compares ignoring case.
    expect(evaluate([5, 'abc'], ['A1:A2', cellIs('greaterThan', '100')])[1]).toEqual(RED);
    expect(evaluate(['North', 'south'], ['A1:A2', cellIs('equal', '"SOUTH"')])).toEqual([
      undefined,
      RED,
    ]);
    expect(evaluate([1, 5, 10], ['A1:A3', cellIs('between', '6', '2')])).toEqual([
      undefined,
      RED,
      undefined,
    ]);
  });

  it('follows absolute and relative cell references', () => {
    expect(evaluate([5, 3, 8], ['A1:A3', cellIs('greaterThan', '$A$1')])).toEqual([
      undefined,
      undefined,
      RED,
    ]);
    // Relative to the range's top-left cell: each cell is compared with the one above it.
    expect(evaluate([1, 5, 2], ['A2:A3', cellIs('greaterThan', 'A1')])).toEqual([
      undefined,
      RED,
      undefined,
    ]);
  });

  it('matches text, ranks, averages and duplicates', () => {
    const rule = (type: string, attrs = '') =>
      `<cfRule type="${type}" dxfId="0" priority="1" ${attrs}/>`;
    expect(
      evaluate(['apple', 'grape', 'kiwi'], ['A1:A3', rule('containsText', 'text="AP"')]),
    ).toEqual([RED, RED, undefined]);
    expect(evaluate([1, 9, 5, 7], ['A1:A4', rule('top10', 'rank="2"')])).toEqual([
      undefined,
      RED,
      undefined,
      RED,
    ]);
    expect(
      evaluate([1, 9, 5, 7], ['A1:A4', rule('top10', 'rank="25" percent="1" bottom="1"')]),
    ).toEqual([RED, undefined, undefined, undefined]);
    expect(evaluate([1, 2, 3, 10], ['A1:A4', rule('aboveAverage')])).toEqual([
      undefined,
      undefined,
      undefined,
      RED,
    ]);
    expect(evaluate([1, 2, 3, 10], ['A1:A4', rule('aboveAverage', 'aboveAverage="0"')])).toEqual([
      RED,
      RED,
      RED,
      undefined,
    ]);
    expect(evaluate(['a', 'A', 'b'], ['A1:A3', rule('duplicateValues')])).toEqual([
      RED,
      RED,
      undefined,
    ]);
    expect(evaluate(['a', 'A', 'b'], ['A1:A3', rule('uniqueValues')])).toEqual([
      undefined,
      undefined,
      RED,
    ]);
  });

  it('colors cells along a scale and sizes data bars', () => {
    const scale =
      '<cfRule type="colorScale" priority="1"><colorScale><cfvo type="min"/><cfvo type="max"/>' +
      '<color rgb="FFF8696B"/><color rgb="FF63BE7B"/></colorScale></cfRule>';
    expect(evaluate([0, 5, 10, 'x'], ['A1:A4', scale])).toEqual([
      { fill: '#f8696b' },
      { fill: '#ae9473' },
      { fill: '#63be7b' },
      undefined,
    ]);
    const bar =
      '<cfRule type="dataBar" priority="1"><dataBar showValue="0"><cfvo type="min"/><cfvo type="max"/>' +
      '<color rgb="FF638EC6"/></dataBar></cfRule>';
    const bars = evaluate([0, 5, 10], ['A1:A3', bar]);
    [0.1, 0.5, 0.9].forEach((length, i) => expect(bars[i]?.bar?.length).toBeCloseTo(length));
    expect(bars[0]).toMatchObject({ bar: { color: '#638ec6' }, hideValue: true });
  });

  it('lets higher-priority rules win and stop the rest', () => {
    const bold = (stop = '') =>
      `<cfRule type="cellIs" dxfId="1" priority="1" operator="greaterThan"${stop}><formula>0</formula></cfRule>`;
    const red =
      '<cfRule type="cellIs" dxfId="0" priority="2" operator="greaterThan"><formula>0</formula></cfRule>';
    expect(evaluate([1], ['A1', red], ['A1', bold()])[0]).toEqual({ ...RED, ...BOLD });
    expect(evaluate([1], ['A1', red], ['A1', bold(' stopIfTrue="1"')])[0]).toEqual(BOLD);
  });

  it('skips rules it cannot evaluate', () => {
    const expression =
      '<cfRule type="expression" dxfId="0" priority="1"><formula>MOD(ROW(),2)=0</formula></cfRule>';
    expect(evaluate([1, 2], ['A1:A2', expression])).toEqual([undefined, undefined]);
    expect(evaluate([1, 2], ['A1:A2', cellIs('greaterThan', 'SUM(B1:B2)')])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('reads the rules of the sample workbook', async () => {
    const workbook = await openWorkbook(
      new Uint8Array(readFileSync('test/fixtures/sample.xlsx')),
      'en-US',
    );
    const budget = await workbook.readSheet(0);
    const at = (ref: string) => {
      const { row, col } = parseCellRef(ref)!;
      for (let i = budget.rowStarts[row]; i < budget.rowStarts[row + 1]; i++) {
        if (budget.cellCols[i] === col) return budget.conditional.get(i);
      }
      return undefined;
    };
    expect(at('D5')).toEqual(RED);
    expect(at('D3')).toBeUndefined();
    expect(at('C8')?.bar?.length).toBeCloseTo(0.9);
    expect(at('B8')?.fill).toBe('#63be7b');
    expect(at('E3')).toEqual({ bold: true, italic: true });
  });
});

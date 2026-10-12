import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { readThemeColors, resolveColor } from '../../src/webview/xlsx/excelColors';
import { CellKind, type SheetData, type WorkbookInfo } from '../../src/webview/xlsx/model';
import { builtInFormats, formatNumber } from '../../src/webview/xlsx/numberFormat';
import { openWorkbook } from '../../src/webview/xlsx/parse';
import { parseCellRef } from '../../src/webview/xlsx/refs';
import { decodeEntities, elements, textRuns } from '../../src/webview/xlsx/xml';

const bytes = new Uint8Array(readFileSync('test/fixtures/sample.xlsx'));

function cell(sheet: SheetData, ref: string) {
  const { row, col } = parseCellRef(ref)!;
  for (let i = sheet.rowStarts[row]; i < sheet.rowStarts[row + 1]; i++) {
    if (sheet.cellCols[i] === col) {
      return {
        text: sheet.texts[sheet.cellTexts[i]],
        kind: sheet.cellKinds[i],
        number: sheet.cellNumbers[i],
        style: sheet.cellStyles[i],
        formatColor: sheet.cellFormatColors[i],
      };
    }
  }
  return undefined;
}

describe('openWorkbook', () => {
  let info: WorkbookInfo;
  let budget: SheetData;

  beforeAll(async () => {
    const workbook = await openWorkbook(bytes, 'en-US');
    info = workbook.info;
    budget = await workbook.readSheet(0);
  });

  it('lists sheets with visibility and tab colors', () => {
    expect(info.sheets.map((s) => s.name)).toEqual([
      'Budget',
      'Data',
      'Hidden',
      'No Grid',
      'Charts',
    ]);
    expect(info.sheets[2].hidden).toBe(true);
    expect(info.sheets[0].tabColor).toBe('#70ad47');
    expect(info.activeSheet).toBe(0);
  });

  it('reads values as Excel displays them', () => {
    expect(cell(budget, 'A1')?.text).toBe('Q3 Budget Overview');
    expect(cell(budget, 'B3')).toMatchObject({
      text: '1,240',
      kind: CellKind.Number,
      number: 1240,
    });
    expect(cell(budget, 'D5')?.text).toBe('-4.1%');
    expect(cell(budget, 'A13')?.text).toBe('$1,234.50');
    expect(cell(budget, 'F3')?.text).toBe('10/15/2024');
    expect(cell(budget, 'B13')?.text).toBe('2024-11-04');
    expect(cell(budget, 'B11')).toMatchObject({ text: 'TRUE', kind: CellKind.Boolean });
    expect(cell(budget, 'D11')).toMatchObject({ text: '#DIV/0!', kind: CellKind.Error });
  });

  it('marks values a number format colors', () => {
    expect(cell(budget, 'D5')?.formatColor).toBeGreaterThan(0);
    expect(cell(budget, 'D3')?.formatColor).toBe(0);
  });

  it('keeps styled empty cells so their borders and fills render', () => {
    expect(cell(budget, 'E9')).toMatchObject({ kind: CellKind.Empty });
  });

  it('reads layout: merges, frozen panes, sizes', () => {
    expect([...budget.merges]).toEqual([0, 0, 0, 5]);
    expect(budget.frozenRows).toBe(2);
    expect(budget.frozenCols).toBe(1);
    expect(budget.rowHeights[0]).toBe(Math.round(28 * (96 / 72)));
    expect(budget.colWidths[0]).toBeGreaterThan(budget.colWidths[1]);
    expect(budget.showGridLines).toBe(true);
  });

  it('resolves styles: fonts, theme fills with tint, borders, alignment', () => {
    const title = info.styles[cell(budget, 'A1')!.style];
    expect(title).toMatchObject({
      bold: true,
      size: 14,
      color: '#ffffff',
      fill: '#1f4e79',
      horizontal: 'center',
    });
    const header = info.styles[cell(budget, 'A2')!.style];
    expect(header.fill).toBe('#dae3f3');
    expect(header.border.bottom).toEqual({ style: 'medium', color: undefined });
    const note = info.styles[cell(budget, 'E4')!.style];
    expect(note).toMatchObject({ italic: true, wrap: true, vertical: 'top' });
  });

  it('shows short dates in the user locale', async () => {
    const turkish = await openWorkbook(bytes, 'tr-TR');
    const sheet = await turkish.readSheet(0);
    expect(cell(sheet, 'F3')?.text).toBe('15.10.2024');
  });

  it('reads later sheets on demand', async () => {
    const workbook = await openWorkbook(bytes, 'en-US');
    const data = await workbook.readSheet(1);
    expect(cell(data, 'F1')?.text).toBe('Revenue');
    expect(data.frozenRows).toBe(1);
    expect(data.rowCount).toBe(2001);
    const noGrid = await workbook.readSheet(3);
    expect(noGrid.showGridLines).toBe(false);
  });

  it('reads pictures, chart titles and text boxes', async () => {
    const workbook = await openWorkbook(bytes, 'en-US');
    const sheet = await workbook.readSheet(4);
    const [chart, picture, text, untitled, badge] = sheet.drawings;
    expect(chart).toMatchObject({
      kind: 'chart',
      from: { col: 1, row: 2, colOffset: 0, rowOffset: 0 },
      to: { col: 8, row: 17 },
      text: 'Q3 revenue by region',
    });
    expect(picture).toMatchObject({ kind: 'picture', mime: 'image/png', from: { col: 9, row: 0 } });
    expect([...picture.image!.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(text).toMatchObject({
      kind: 'text',
      text: 'Pictures, charts and text boxes\nare drawn over the grid.',
      fill: '#ffffff',
      width: 320,
      height: 64,
    });
    // An axis title is not the chart's title.
    expect(untitled).toMatchObject({ kind: 'chart', text: '' });
    expect(badge).toMatchObject({ kind: 'picture', from: { col: 30, row: 70 }, width: 96 });
  });

  it('grows a sheet to fit drawings past its data', async () => {
    const workbook = await openWorkbook(bytes, 'en-US');
    const sheet = await workbook.readSheet(4);
    expect(sheet.rowCount).toBeGreaterThan(71);
    expect(sheet.colCount).toBeGreaterThan(30);
    expect(sheet.rowStarts).toHaveLength(sheet.rowCount + 1);
    expect(sheet.rowHeights).toHaveLength(sheet.rowCount);
    expect(sheet.colWidths).toHaveLength(sheet.colCount);
    expect(sheet.rowHeights[sheet.rowCount - 1]).toBe(sheet.defaultRowHeight);
  });

  it('rejects files that are not workbooks', async () => {
    await expect(openWorkbook(new Uint8Array([1, 2, 3]), 'en-US')).rejects.toThrow();
  });
});

describe('number formats', () => {
  it('derives localized short dates', () => {
    expect(builtInFormats('tr-TR')[14]).toBe('dd\\.mm\\.yyyy');
    expect(builtInFormats('en-US')[14]).toBe('m\\/d\\/yyyy');
    expect(builtInFormats('de-DE')[14]).toBe('d\\.m\\.yyyy');
  });

  it('formats numbers and picks section colors', () => {
    expect(formatNumber(1234.5, '#,##0.00', false)).toEqual({ text: '1,234.50', color: 0 });
    expect(formatNumber(-0.25, '0%;[Red]-0%', false).color).toBeGreaterThan(0);
    expect(formatNumber(0.25, '0%;[Red]-0%', false).color).toBe(0);
  });
});

describe('Excel colors', () => {
  const theme = readThemeColors(undefined);

  it('resolves rgb, theme and indexed colors', () => {
    expect(resolveColor({ rgb: 'FF1F4E79' }, theme)).toBe('#1f4e79');
    expect(resolveColor({ theme: '4' }, theme)).toBe('#4472c4');
    expect(resolveColor({ indexed: '10' }, theme)).toBe('#ff0000');
    expect(resolveColor({ auto: '1' }, theme)).toBeUndefined();
  });

  it('applies tint like Excel', () => {
    expect(resolveColor({ theme: '4', tint: '0.79998168889431442' }, theme)).toBe('#dae3f3');
    expect(resolveColor({ theme: '4', tint: '-0.249977111117893' }, theme)).toBe('#2f5597');
  });

  it('reads the scheme from a theme part, swapping the first two pairs', () => {
    const xml =
      '<a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1>' +
      '<a:lt1><a:srgbClr val="EEEEEE"/></a:lt1><a:dk2><a:srgbClr val="222222"/></a:dk2>' +
      '<a:lt2><a:srgbClr val="DDDDDD"/></a:lt2><a:accent1><a:srgbClr val="ABCDEF"/></a:accent1></a:clrScheme>';
    const colors = readThemeColors(xml);
    expect(colors.slice(0, 5)).toEqual(['EEEEEE', '111111', 'DDDDDD', '222222', 'ABCDEF']);
  });
});

describe('xml helpers', () => {
  it('decodes entities and Excel escapes', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#233;&#x41; _x000D_')).toBe('a & b <c> éA \r');
  });

  it('joins rich text runs and skips phonetic runs', () => {
    expect(
      textRuns(
        '<r><t>Hello </t></r><r><t xml:space="preserve">world</t></r><rPh><t>ignored</t></rPh>',
      ),
    ).toBe('Hello world');
  });

  it('matches elements with namespace prefixes but not longer names', () => {
    const xml = '<x:c r="A1"><x:v>1</x:v></x:c><col min="1"/><c r="B1"/>';
    expect([...elements(xml, 'c')].map((el) => el.attrs.r)).toEqual(['A1', 'B1']);
  });

  it('parses cell references', () => {
    expect(parseCellRef('A1')).toEqual({ row: 0, col: 0 });
    expect(parseCellRef('$AB$12')).toEqual({ row: 11, col: 27 });
    expect(parseCellRef('nope')).toBeUndefined();
  });
});

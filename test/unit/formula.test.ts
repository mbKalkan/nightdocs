import { describe, expect, it } from 'vitest';
import { displayFormula } from '../../src/webview/xlsx/formula';
import { parseSheet } from '../../src/webview/xlsx/parse';
import { parseCellRef } from '../../src/webview/xlsx/refs';

describe('displayFormula', () => {
  it('drops the prefixes files keep on newer functions', () => {
    expect(displayFormula('_xlfn.XLOOKUP(A2,B:B,C:C)')).toBe('XLOOKUP(A2,B:B,C:C)');
    expect(displayFormula('_xlfn._xlws.SORT(A2:A9)')).toBe('SORT(A2:A9)');
    expect(displayFormula('_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1)(2)')).toBe('LAMBDA(x,x+1)(2)');
  });

  it('moves relative references and keeps absolute ones', () => {
    expect(displayFormula('C3/B3-1', 2, 0)).toBe('C5/B5-1');
    expect(displayFormula('$A$1+A1+$A1+A$1', 1, 1)).toBe('$A$1+B2+$A2+B$1');
    expect(displayFormula('SUM(B2:B9)*Rate', 0, 2)).toBe('SUM(D2:D9)*Rate');
    expect(displayFormula('SUM(A:A,3:3)', 1, 1)).toBe('SUM(B:B,4:4)');
    expect(displayFormula('Z1+AA1', 0, 1)).toBe('AA1+AB1');
  });

  it('moves references to other sheets, but not sheet names or function names', () => {
    expect(displayFormula("Data!A1+'Q3 Plan'!B2+Q3!C1", 1, 0)).toBe("Data!A2+'Q3 Plan'!B3+Q3!C2");
    expect(displayFormula('LOG10(A1)+ATAN2(B1,C1)', 1, 0)).toBe('LOG10(A2)+ATAN2(B2,C2)');
  });

  it('leaves text, structured references and numbers alone', () => {
    expect(displayFormula('IF(A1="B2","A1 "&B2,"")', 1, 0)).toBe('IF(A2="B2","A1 "&B3,"")');
    expect(displayFormula('SUM(Sales[[#This Row],[Q1]:[Q4]])+A1', 1, 0)).toBe(
      'SUM(Sales[[#This Row],[Q1]:[Q4]])+A2',
    );
    expect(displayFormula('A1*1.5E+3+2', 1, 0)).toBe('A2*1.5E+3+2');
  });

  it('turns references moved off the sheet into #REF!', () => {
    expect(displayFormula('A1+B2', -1, 0)).toBe('#REF!+B1');
    expect(displayFormula('SUM(A1:A3)', 0, -1)).toBe('SUM(#REF!)');
  });
});

describe('formulas in sheets', () => {
  const sheet = parseSheet(
    `<worksheet><sheetData>
      <row r="2">
        <c r="C2"><f>SUM(A2:B2)</f><v>3</v></c>
        <c r="D2"><f t="shared" ref="D2:D4" si="0">C2*2</f><v>6</v></c>
      </row>
      <row r="3"><c r="D3"><f t="shared" si="0"/><v>8</v></c></row>
      <row r="4"><c r="D4"><f t="shared" si="0"/><v>10</v></c></row>
      <row r="5">
        <c r="A5"><f t="array" ref="A5:B5">TRANSPOSE(A1:A2)</f><v>1</v></c>
        <c r="B5"><v>2</v></c>
        <c r="C5" cm="1"><f t="array" ref="C5">_xlfn.UNIQUE(A1:A9)</f><v>1</v></c>
        <c r="D5" t="str"><f>"a&amp;b"&amp;A1</f><v>a&amp;b1</v></c>
      </row>
    </sheetData></worksheet>`,
    { sharedStrings: [], styles: [], formats: [], date1904: false },
  );
  const formulaAt = (ref: string) => {
    const { row, col } = parseCellRef(ref)!;
    for (let i = sheet.rowStarts[row]; i < sheet.rowStarts[row + 1]; i++) {
      if (sheet.cellCols[i] === col) return sheet.formulas.get(i);
    }
    return undefined;
  };

  it('reads plain formulas and unescapes them', () => {
    expect(formulaAt('C2')).toBe('=SUM(A2:B2)');
    expect(formulaAt('D5')).toBe('="a&b"&A1');
  });

  it('fills shared formulas into the cells that use them', () => {
    expect(formulaAt('D2')).toBe('=C2*2');
    expect(formulaAt('D3')).toBe('=C3*2');
    expect(formulaAt('D4')).toBe('=C4*2');
  });

  it('shows array formulas in braces across their range, and dynamic arrays without', () => {
    expect(formulaAt('A5')).toBe('{=TRANSPOSE(A1:A2)}');
    expect(formulaAt('B5')).toBe('{=TRANSPOSE(A1:A2)}');
    expect(formulaAt('C5')).toBe('=UNIQUE(A1:A9)');
  });

  it('has no formula for plain values', () => {
    expect(sheet.formulas.size).toBe(8);
  });
});

import { describe, expect, it } from 'vitest';
import { markdownTable, type CopiedCell } from '../../src/webview/xlsx/markdown';

const text = (value: string): CopiedCell => ({ text: value, number: false });
const number = (value: string): CopiedCell => ({ text: value, number: true });

describe('markdownTable', () => {
  it('makes the first row the header and aligns columns of numbers right', () => {
    expect(
      markdownTable([
        [text('Region'), text('Q2'), text('Change')],
        [text('North'), number('1,240'), number('11.7%')],
        [text('South'), number('980'), text('n/a')],
      ]),
    ).toBe(
      [
        '| Region | Q2 | Change |',
        '| --- | ---: | --- |',
        '| North | 1,240 | 11.7% |',
        '| South | 980 | n/a |',
      ].join('\n'),
    );
  });

  it('escapes pipes and backslashes and keeps line breaks', () => {
    expect(markdownTable([[text('A|B')], [text('C:\\temp\nsecond line')]])).toBe(
      ['| A\\|B |', '| --- |', '| C:\\\\temp<br>second line |'].join('\n'),
    );
  });

  it('fills short rows and leaves empty columns aligned left', () => {
    expect(markdownTable([[text('Name'), text('')], [text('x')]])).toBe(
      ['| Name |  |', '| --- | --- |', '| x |  |'].join('\n'),
    );
  });
});

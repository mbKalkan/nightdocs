import { describe, expect, it } from 'vitest';
import { composeReference, quote } from '../../src/shared/reference';

describe('composeReference', () => {
  it('names the file, then the place', () => {
    expect(composeReference('docs/report.docx', 'page 3, under "Regional results"')).toBe(
      'docs/report.docx, page 3, under "Regional results"',
    );
  });

  it('puts the text on the lines after a colon', () => {
    expect(composeReference('budget.xlsx', 'sheet "Budget", cell B4', '> 1,240')).toBe(
      'budget.xlsx, sheet "Budget", cell B4:\n> 1,240',
    );
  });
});

describe('quote', () => {
  it('prefixes each line and drops blank ones', () => {
    expect(quote('Highlights\n\n  Retention reached an all-time high.  \n')).toBe(
      '> Highlights\n> Retention reached an all-time high.',
    );
  });

  it('accepts Windows line ends', () => {
    expect(quote('a\r\nb')).toBe('> a\n> b');
  });
});

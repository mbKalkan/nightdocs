import { describe, expect, it } from 'vitest';
import { orderSides } from '../../src/extension/diffSides';
import { align } from '../../src/webview/diff/align';

describe('align', () => {
  const original = [
    'Quarterly Report',
    'Prepared for the leadership team. Confidential',
    'Onboarding time dropped by two days.',
    'Self-service answers most common questions.',
    'East',
    '1,105',
    '1,060',
    '-4.1%',
    'Review pricing in the East region.',
  ];
  const revised = [
    'Quarterly Report',
    'Prepared for the board. Confidential',
    'Onboarding time dropped by three days.',
    'Churn fell for the third quarter in a row.',
    'East',
    '1,105',
    '1,095',
    '-0.9%',
    'Review pricing in the East region.',
    'Open a support hub in Lisbon.',
  ];
  const { hunks, aToB, bToA } = align(original, revised);

  it('groups changes into hunks', () => {
    expect(hunks.map(({ aStart, aEnd, bStart, bEnd }) => [aStart, aEnd, bStart, bEnd])).toEqual([
      [1, 4, 1, 4],
      [6, 8, 6, 8],
      [9, 9, 9, 10],
    ]);
  });

  it('pairs edited paragraphs and keeps replaced ones apart', () => {
    // The bullet that changed one word is an edit; the one that was swapped for another isn't.
    expect(hunks[0].pairs).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('pairs short items replaced one for one, like table cells', () => {
    expect(hunks[1].pairs).toEqual([
      [6, 6],
      [7, 7],
    ]);
  });

  it('maps every item to the place it has on the other side', () => {
    expect(aToB).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bToA).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 8]);
  });

  it('handles an empty side', () => {
    expect(align([], ['a', 'b'])).toEqual({
      hunks: [{ aStart: 0, aEnd: 0, bStart: 0, bEnd: 2, pairs: [] }],
      aToB: [],
      bToA: [0, 0],
    });
  });
});

describe('orderSides', () => {
  const file = (name: string, scheme = 'file') => ({ name, scheme });
  const describe_ = (x: { name: string; scheme: string }) => x;

  it('follows the order of the names in the tab label', () => {
    const a = file('old.docx');
    const b = file('new.docx');
    expect(orderSides(a, b, describe_, 'old.docx ↔ new.docx')).toEqual([a, b]);
    expect(orderSides(b, a, describe_, 'old.docx ↔ new.docx')).toEqual([a, b]);
  });

  it('puts the file on disk on the right when Git compares a file with itself', () => {
    const disk = file('report.docx');
    const git = file('report.docx', 'git');
    expect(orderSides(disk, git, describe_, 'report.docx ↔ report.docx')).toEqual([git, disk]);
    expect(orderSides(git, disk, describe_, 'report.docx ↔ report.docx')).toEqual([git, disk]);
  });

  it('keeps the order the viewers came in otherwise', () => {
    const a = file('report.docx', 'git');
    const b = file('report.docx', 'git');
    expect(orderSides(a, b, describe_, 'report.docx ↔ report.docx')).toEqual([a, b]);
  });
});

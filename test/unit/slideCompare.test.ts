import { describe, expect, it } from 'vitest';
import { slideRows } from '../../src/webview/diff/slideCompare';

const title = 'Quarterly Review Prepared for the leadership team';
const highlights = 'Highlights Revenue grew in three of four regions Support backlog down 40%';
const results = 'Regional results North 1,240 1,385 South 980 1,012 East 1,105 1,060';
const shapes = 'Shapes and pictures Rounded Note: pictures keep their colors';
const dark = 'Already dark Slides designed dark stay as they are';
const closing = 'Thank you Questions?';

describe('slideRows', () => {
  it('pairs every slide of identical decks, with no changes', () => {
    const deck = [title, highlights, results];
    expect(slideRows(deck, deck)).toEqual([
      { a: 0, b: 0, changed: false },
      { a: 1, b: 1, changed: false },
      { a: 2, b: 2, changed: false },
    ]);
  });

  it('pairs edited slides and leaves added and removed ones without a counterpart', () => {
    const original = [title, highlights, results, shapes, dark, closing];
    const revised = [
      title,
      highlights.replace('40%', '55%'),
      results.replace('1,060', '1,095'),
      'Next steps Open two more offices in the South',
      shapes,
      closing,
    ];
    expect(slideRows(original, revised)).toEqual([
      { a: 0, b: 0, changed: false },
      { a: 1, b: 1, changed: true },
      { a: 2, b: 2, changed: true },
      { b: 3, changed: true },
      { a: 3, b: 4, changed: false },
      { a: 4, changed: true },
      { a: 5, b: 5, changed: false },
    ]);
  });

  it('counts a slide rewritten in place as edited', () => {
    expect(slideRows([title, dark, closing], [title, shapes, closing])).toEqual([
      { a: 0, b: 0, changed: false },
      { a: 1, b: 1, changed: true },
      { a: 2, b: 2, changed: false },
    ]);
  });

  it('puts slides only the original has before those only the revision has', () => {
    expect(slideRows([title, dark, results], [title, closing, shapes, results])).toEqual([
      { a: 0, b: 0, changed: false },
      { a: 1, changed: true },
      { b: 1, changed: true },
      { b: 2, changed: true },
      { a: 2, b: 3, changed: false },
    ]);
  });

  it('lines up slides added at the end or to an empty deck', () => {
    expect(slideRows([title], [title, closing])).toEqual([
      { a: 0, b: 0, changed: false },
      { b: 1, changed: true },
    ]);
    expect(slideRows([], [title])).toEqual([{ b: 0, changed: true }]);
  });
});

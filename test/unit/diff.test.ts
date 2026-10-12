import { describe, expect, it } from 'vitest';
import { diff, sameToken, similarity, tokenize, type DiffRange } from '../../src/shared/diff';

/** Applies the ranges to `a` and checks they produce `b`, covering both sequences in order. */
function replay<T>(a: readonly T[], b: readonly T[], ranges: DiffRange[]): T[] {
  const out: T[] = [];
  let aAt = 0;
  let bAt = 0;
  for (const range of ranges) {
    expect(range.aStart).toBe(aAt);
    expect(range.bStart).toBe(bAt);
    if (range.kind === 'equal') {
      expect(range.aEnd - range.aStart).toBe(range.bEnd - range.bStart);
      out.push(...a.slice(range.aStart, range.aEnd));
    } else if (range.kind === 'insert') {
      expect(range.aEnd).toBe(range.aStart);
      out.push(...b.slice(range.bStart, range.bEnd));
    } else {
      expect(range.bEnd).toBe(range.bStart);
    }
    aAt = range.aEnd;
    bAt = range.bEnd;
  }
  expect(aAt).toBe(a.length);
  expect(bAt).toBe(b.length);
  return out;
}

const edits = (ranges: DiffRange[]) =>
  ranges
    .filter((r) => r.kind !== 'equal')
    .reduce((sum, r) => sum + (r.aEnd - r.aStart) + (r.bEnd - r.bStart), 0);

describe('diff', () => {
  it('finds nothing to change in equal sequences', () => {
    expect(diff([1, 2, 3], [1, 2, 3])).toEqual([
      { kind: 'equal', aStart: 0, aEnd: 3, bStart: 0, bEnd: 3 },
    ]);
    expect(diff([], [])).toEqual([]);
  });

  it('reports insertions, deletions and replacements', () => {
    const a = ['title', 'intro', 'old point', 'table', 'end'];
    const b = ['title', 'new intro', 'intro', 'table', 'added', 'end'];
    const ranges = diff(a, b);
    expect(replay(a, b, ranges)).toEqual(b);
    expect(edits(ranges)).toBe(3);
    expect(ranges.map((r) => r.kind)).toEqual([
      'equal',
      'insert',
      'equal',
      'delete',
      'equal',
      'insert',
      'equal',
    ]);
  });

  it('puts deletions before the insertions that replace them', () => {
    const ranges = diff(['a', 'x', 'y', 'b'], ['a', 'p', 'q', 'b']);
    expect(ranges.map((r) => r.kind)).toEqual(['equal', 'delete', 'insert', 'equal']);
    expect(ranges[1]).toMatchObject({ aStart: 1, aEnd: 3, bStart: 1, bEnd: 1 });
    expect(ranges[2]).toMatchObject({ aStart: 3, aEnd: 3, bStart: 1, bEnd: 3 });
  });

  it('finds a shortest script for random edits', () => {
    let seed = 3;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 50; run++) {
      const a = Array.from({ length: Math.floor(random() * 40) }, () => Math.floor(random() * 6));
      const b = a.filter(() => random() > 0.2);
      for (let i = 0; i < 5; i++) b.splice(Math.floor(random() * (b.length + 1)), 0, 9);
      const ranges = diff(a, b);
      expect(replay(a, b, ranges)).toEqual(b);
      // Every kept item of `a` is in `b`, so at most the removed and added ones are edits.
      expect(edits(ranges)).toBeLessThanOrEqual(a.length - b.length + 10);
    }
  });

  it('uses the given comparison', () => {
    const ranges = diff(['A', 'b'], ['a', 'B'], (x, y) => x.toLowerCase() === y.toLowerCase());
    expect(ranges).toEqual([{ kind: 'equal', aStart: 0, aEnd: 2, bStart: 0, bEnd: 2 }]);
  });

  it('stays quick when two long sequences have nothing in common', () => {
    const a = Array.from({ length: 5000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 5000 }, (_, i) => `b${i}`);
    const started = performance.now();
    const ranges = diff(a, b);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(replay(a, b, ranges)).toEqual(b);
  });
});

describe('tokenize', () => {
  it('splits words, numbers, whitespace and punctuation, with their offsets', () => {
    expect(tokenize('Grew 11.7%, to 1,060.').map((t) => [t.text, t.start])).toEqual([
      ['Grew', 0],
      [' ', 4],
      ['11.7', 5],
      ['%', 9],
      [',', 10],
      [' ', 11],
      ['to', 12],
      [' ', 14],
      ['1,060', 15],
      ['.', 20],
    ]);
  });

  it('keeps letters of any script together', () => {
    expect(tokenize('Çalışma güzel').map((t) => t.text)).toEqual(['Çalışma', ' ', 'güzel']);
  });

  it('treats any whitespace as the same token', () => {
    expect(sameToken({ text: '  ', start: 0 }, { text: '\n', start: 0 })).toBe(true);
    expect(sameToken({ text: 'a', start: 0 }, { text: 'A', start: 0 })).toBe(false);
  });
});

describe('similarity', () => {
  it('scores shared words', () => {
    expect(similarity('Onboarding dropped by two days', 'Onboarding dropped by three days')).toBe(
      0.8,
    );
    expect(similarity('Revenue grew', 'Hire two engineers')).toBe(0);
    expect(similarity('Same text', 'same TEXT')).toBe(1);
  });
});

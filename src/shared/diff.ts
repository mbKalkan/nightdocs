// Sequence diffing for comparing two versions of a document.

export interface DiffRange {
  /** `equal` items are in both sequences, `delete` only in `a`, `insert` only in `b`. */
  kind: 'equal' | 'delete' | 'insert';
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/**
 * Past this many edits the two sequences have little in common, and finding the shortest
 * edit script would take a lot of time and memory; the rest is reported as replaced.
 */
const MAX_EDITS = 2000;

/**
 * Shortest edit script from `a` to `b` (Myers' algorithm), as ranges in order. Consecutive
 * deletions come before the insertions that replace them.
 */
export function diff<T>(
  a: readonly T[],
  b: readonly T[],
  equals: (x: T, y: T) => boolean = Object.is,
): DiffRange[] {
  let start = 0;
  while (start < a.length && start < b.length && equals(a[start], b[start])) start++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && equals(a[aEnd - 1], b[bEnd - 1])) {
    aEnd--;
    bEnd--;
  }

  const ranges: DiffRange[] = [];
  const push = (
    kind: DiffRange['kind'],
    aFrom: number,
    aTo: number,
    bFrom: number,
    bTo: number,
  ) => {
    if (aFrom === aTo && bFrom === bTo) return;
    const last = ranges[ranges.length - 1];
    if (last?.kind === kind && last.aEnd === aFrom && last.bEnd === bFrom) {
      last.aEnd = aTo;
      last.bEnd = bTo;
    } else {
      ranges.push({ kind, aStart: aFrom, aEnd: aTo, bStart: bFrom, bEnd: bTo });
    }
  };

  push('equal', 0, start, 0, start);
  const steps = shortestEdit(a, b, start, aEnd, start, bEnd, equals);
  if (steps) {
    for (const step of steps) push(step.kind, step.a, step.a2, step.b, step.b2);
  } else {
    push('delete', start, aEnd, start, start);
    push('insert', aEnd, aEnd, start, bEnd);
  }
  push('equal', aEnd, a.length, bEnd, b.length);
  return orderReplacements(ranges);
}

interface Step {
  kind: DiffRange['kind'];
  a: number;
  a2: number;
  b: number;
  b2: number;
}

function shortestEdit<T>(
  a: readonly T[],
  b: readonly T[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  equals: (x: T, y: T) => boolean,
): Step[] | undefined {
  const n = a1 - a0;
  const m = b1 - b0;
  const max = n + m;
  if (max === 0) return [];
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  /** `trace[d][k + d]` is the furthest x on diagonal k after d edits. */
  const trace: Int32Array[] = [];

  for (let d = 0; d <= Math.min(max, MAX_EDITS); d++) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && equals(a[a0 + x], b[b0 + y])) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice(offset - d, offset + d + 1));
        return backtrack(trace, n, m, a0, b0);
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
  }
  return undefined;
}

function backtrack(trace: Int32Array[], n: number, m: number, a0: number, b0: number): Step[] {
  const steps: Step[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const previous = trace[d - 1];
    const at = (k: number) => previous[k + d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const startX = down ? prevX : prevX + 1;
    const startY = down ? prevY + 1 : prevY;
    if (x > startX) steps.push(step('equal', startX, x, startY, y, a0, b0));
    steps.push(
      down
        ? step('insert', prevX, prevX, prevY, prevY + 1, a0, b0)
        : step('delete', prevX, prevX + 1, prevY, prevY, a0, b0),
    );
    x = prevX;
    y = prevY;
  }
  if (x > 0) steps.push(step('equal', 0, x, 0, y, a0, b0));
  return steps.reverse();
}

function step(
  kind: DiffRange['kind'],
  a: number,
  a2: number,
  b: number,
  b2: number,
  a0: number,
  b0: number,
): Step {
  return { kind, a: a0 + a, a2: a0 + a2, b: b0 + b, b2: b0 + b2 };
}

/** Within each run of changes, puts all deletions before all insertions. */
function orderReplacements(ranges: DiffRange[]): DiffRange[] {
  const result: DiffRange[] = [];
  let i = 0;
  while (i < ranges.length) {
    if (ranges[i].kind === 'equal') {
      result.push(ranges[i++]);
      continue;
    }
    const first = ranges[i];
    let last = first;
    while (i < ranges.length && ranges[i].kind !== 'equal') last = ranges[i++];
    const { aStart, bStart } = first;
    const { aEnd, bEnd } = last;
    if (aEnd > aStart) result.push({ kind: 'delete', aStart, aEnd, bStart, bEnd: bStart });
    if (bEnd > bStart) result.push({ kind: 'insert', aStart: aEnd, aEnd, bStart, bEnd });
  }
  return result;
}

export interface Token {
  text: string;
  /** Offset of the token in the text it came from. */
  start: number;
}

/** A number with its separators ("1,060.5") or a word. */
const WORD = /\p{N}+(?:[.,]\p{N}+)*|[\p{L}\p{N}_]+/gu;
const TOKEN = new RegExp(String.raw`${WORD.source}|\s+|[^\p{L}\p{N}_\s]`, 'gu');

/** Splits text into numbers, words, runs of whitespace and single other characters. */
export function tokenize(text: string): Token[] {
  return Array.from(text.matchAll(TOKEN), (match) => ({
    text: match[0],
    start: match.index,
  }));
}

/** Tokens compare equal when they're the same, or both whitespace of any kind. */
export function sameToken(x: Token, y: Token): boolean {
  return x.text === y.text || (/^\s+$/.test(x.text) && /^\s+$/.test(y.text));
}

/**
 * How much two texts share, from 0 (nothing) to 1 (the same words), as the Dice coefficient
 * of their words. Used to tell an edited paragraph from a replaced one.
 */
export function similarity(x: string, y: string): number {
  const words = (text: string) => text.toLowerCase().match(WORD) ?? [];
  const a = words(x);
  const b = words(y);
  if (a.length === 0 && b.length === 0) return x.trim() === y.trim() ? 1 : 0;
  const counts = new Map<string, number>();
  for (const word of a) counts.set(word, (counts.get(word) ?? 0) + 1);
  let common = 0;
  for (const word of b) {
    const count = counts.get(word) ?? 0;
    if (count > 0) {
      common++;
      counts.set(word, count - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}

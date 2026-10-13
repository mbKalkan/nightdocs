import { diff, similarity } from '../../shared/diff';

/** A run of items that differ between the two versions. */
export interface Hunk {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  /** Items of `a` and `b` that are edited versions of each other, as `[a index, b index]`. */
  pairs: [number, number][];
}

export interface Alignment {
  hunks: Hunk[];
  /** For each item of `a`, the item of `b` at the same place: its match or the closest one. */
  aToB: number[];
  bToA: number[];
}

/** Below this share of common words, a changed item counts as removed and another as added. */
const EDITED = 0.5;

/** Pairing looks this far ahead for an edited item; big rewrites aren't worth pairing up. */
const LOOKAHEAD = 20;

/** Items of up to this many words, like table cells, can be edits even with no word in common. */
const SHORT_WORDS = 3;

export interface AlignOptions {
  /**
   * When as many items are replaced as replace them, which count as edited in place: only
   * short ones like table cells (`short`), or all, like the rows of a sheet (`all`).
   */
  inPlace?: 'short' | 'all';
}

/**
 * Lines up two versions of a list of texts (paragraphs, slides, rows): which items match,
 * which were edited, removed or added.
 */
export function align(
  a: readonly string[],
  b: readonly string[],
  { inPlace = 'short' }: AlignOptions = {},
): Alignment {
  const aToB = new Array<number>(a.length).fill(0);
  const bToA = new Array<number>(b.length).fill(0);
  const hunks: Hunk[] = [];
  const ranges = diff(a, b);

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (range.kind === 'equal') {
      for (let k = 0; k < range.aEnd - range.aStart; k++) {
        aToB[range.aStart + k] = range.bStart + k;
        bToA[range.bStart + k] = range.aStart + k;
      }
      continue;
    }
    const { aStart, aEnd, bStart, bEnd } = range;
    const hunk: Hunk = { aStart, aEnd, bStart, bEnd, pairs: [] };
    const next = ranges[i + 1];
    if (range.kind === 'delete' && next?.kind === 'insert') {
      hunk.bEnd = next.bEnd;
      i++;
    }
    hunk.pairs = pairEdited(a, b, hunk, inPlace === 'all' ? Infinity : SHORT_WORDS);
    hunks.push(hunk);

    // Unpaired items point at the closest paired item before them, or the hunk's start.
    let aAt = hunk.aStart;
    let bAt = hunk.bStart;
    const fill = (until: [number, number]) => {
      const [aFrom, bFrom] = [aAt, bAt];
      for (; aAt < until[0]; aAt++) aToB[aAt] = clamp(bFrom, b.length);
      for (; bAt < until[1]; bAt++) bToA[bAt] = clamp(aFrom, a.length);
    };
    for (const [x, y] of hunk.pairs) {
      fill([x, y]);
      aToB[x] = y;
      bToA[y] = x;
      aAt = x + 1;
      bAt = y + 1;
    }
    fill([hunk.aEnd, hunk.bEnd]);
  }
  return { hunks, aToB, bToA };
}

function pairEdited(
  a: readonly string[],
  b: readonly string[],
  hunk: Hunk,
  shortWords: number,
): [number, number][] {
  const pairs: [number, number][] = [];
  let from = hunk.bStart;
  for (let x = hunk.aStart; x < hunk.aEnd && from < hunk.bEnd; x++) {
    let best = -1;
    let bestScore = 0;
    for (let y = from; y < Math.min(hunk.bEnd, from + LOOKAHEAD); y++) {
      const score = similarity(a[x], b[y]);
      if (score >= EDITED && score > bestScore) {
        best = y;
        bestScore = score;
      }
    }
    if (best >= 0) {
      pairs.push([x, best]);
      from = best + 1;
    }
  }
  return pairShortInPlace(a, b, hunk, pairs, shortWords);
}

/**
 * Short items replaced one for one, like the cells of a table row, share too few words to
 * look alike ("1,060" and "1,095"), but are still edits in place.
 */
function pairShortInPlace(
  a: readonly string[],
  b: readonly string[],
  hunk: Hunk,
  pairs: [number, number][],
  shortWords: number,
): [number, number][] {
  const size = hunk.aEnd - hunk.aStart;
  const inPlace = pairs.every(([x, y]) => x - hunk.aStart === y - hunk.bStart);
  if (size !== hunk.bEnd - hunk.bStart || !inPlace) return pairs;
  const paired = new Set(pairs.map(([x]) => x));
  const short = (text: string) => text.split(' ').length <= shortWords;
  for (let k = 0; k < size; k++) {
    const x = hunk.aStart + k;
    const y = hunk.bStart + k;
    if (!paired.has(x) && short(a[x]) && short(b[y])) pairs.push([x, y]);
  }
  return pairs.sort(([x1], [x2]) => x1 - x2);
}

const clamp = (index: number, length: number) => Math.max(0, Math.min(index, length - 1));

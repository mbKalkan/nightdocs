import type { DiffSide, SlideSummary } from '../../shared/protocol';
import type { Comparison, RenderContext } from '../renderers/types';
import { align } from './align';
import { clearMarks, MARK, markWords, otherChange, ownChange, textOf } from './marks';
import { revealByTops, scrollAnchor, scrollToAnchor, scrollTopOf } from './scrolling';

/** A chart as drawn on a slide. */
export interface SlideChart {
  getDom(): HTMLElement;
  getOption(): unknown;
}

export interface Slides {
  deck: HTMLElement;
  frames: HTMLElement[];
  /** The charts on each slide, in the order they were drawn. */
  charts: SlideChart[][];
}

const CHANGED = 'nd-slide-changed';
const ONLY = 'nd-slide-only';
const OBJECT = 'nd-diff-object';
const CLASSES = [CHANGED, ONLY, OBJECT, 'nd-diff-removed', 'nd-diff-added'];

/** Size of a slide's stand-in when the deck has no slide to take it from. */
const DEFAULT_SIZE = { width: '960px', height: '540px' };

const PICTURES = 'img, image';

/** What each slide is compared by: its text, its pictures, its charts and whether it's hidden. */
export async function summarizeSlides({ frames, charts }: Slides): Promise<SlideSummary[]> {
  const fingerprints = new Map<string, Promise<string>>();
  const fingerprintOf = (url: string) => {
    let fingerprint = fingerprints.get(url);
    if (!fingerprint) fingerprints.set(url, (fingerprint = fingerprintPicture(url)));
    return fingerprint;
  };
  return Promise.all(
    frames.map(async (frame, index) => ({
      text: textOf(frame).replace(/\s+/g, ' ').trim(),
      pictures: await Promise.all(
        [...frame.querySelectorAll(PICTURES)].map((picture) => fingerprintOf(pictureUrl(picture))),
      ),
      charts: (charts[index] ?? []).map(chartData),
      hidden: frame.dataset.hidden !== undefined,
    })),
  );
}

const key = (slide: SlideSummary) =>
  [slide.text, slide.pictures.join(' '), slide.charts.join(' '), slide.hidden].join('\u0000');

/** A step through both versions: a slide of each, or a slide of one and nothing of the other. */
export interface SlideRow {
  a?: number;
  b?: number;
  changed: boolean;
}

/**
 * Lines up the slides of two versions, given as what they are compared by. Where slides differ,
 * those only the first version has come before those only the second has, like a unified diff.
 */
export function slideRows(a: readonly string[], b: readonly string[]): SlideRow[] {
  // A slide replaced by another at the same place is the same slide edited.
  const { hunks } = align(a, b, { inPlace: 'all' });
  const rows: SlideRow[] = [];
  let aAt = 0;
  let bAt = 0;
  const equal = (aTo: number) => {
    for (; aAt < aTo; aAt++, bAt++) rows.push({ a: aAt, b: bAt, changed: false });
  };
  const unpaired = (aTo: number, bTo: number) => {
    for (; aAt < aTo; aAt++) rows.push({ a: aAt, changed: true });
    for (; bAt < bTo; bAt++) rows.push({ b: bAt, changed: true });
  };
  for (const hunk of hunks) {
    equal(hunk.aStart);
    for (const [x, y] of hunk.pairs) {
      unpaired(x, y);
      rows.push({ a: x, b: y, changed: true });
      aAt = x + 1;
      bAt = y + 1;
    }
    unpaired(hunk.aEnd, hunk.bEnd);
  }
  equal(a.length);
  return rows;
}

/**
 * Shows the slides of this side lined up with the other's, with an empty stand-in where the
 * other side has a slide this one doesn't, so both read alike from top to bottom. Marks slides
 * only this side has and the changed words, pictures and charts of edited slides; each marked
 * slide or stand-in is a change of its own to move to.
 */
export function compareSlides(
  slides: Slides,
  own: readonly SlideSummary[],
  peer: readonly SlideSummary[],
  side: DiffSide,
  context: RenderContext,
): Comparison {
  const { deck, frames } = slides;
  const original = side === 'original';
  const rows = original
    ? slideRows(own.map(key), peer.map(key))
    : slideRows(peer.map(key), own.map(key));
  const mark = `nd-diff-${ownChange(side)}`;
  const size = frames[0]?.style ?? DEFAULT_SIZE;
  // Both sides show the same rows, so a row's index is all the other side needs to scroll along.
  const elements: HTMLElement[] = [];
  const stops: HTMLElement[] = [];
  const standIns: HTMLElement[] = [];

  for (const row of rows) {
    const [mine, theirs] = original ? [row.a, row.b] : [row.b, row.a];
    if (mine === undefined) {
      const standIn = document.createElement('div');
      standIn.className = `nd-slide-gap nd-diff-${otherChange(side)}`;
      standIn.style.width = size.width;
      standIn.style.height = size.height;
      standIns.push(standIn);
      elements.push(standIn);
      stops.push(standIn);
      continue;
    }
    const frame = frames[mine];
    elements.push(frame);
    if (!row.changed) continue;
    stops.push(frame);
    if (theirs === undefined) {
      frame.classList.add(ONLY, mark);
      continue;
    }
    frame.classList.add(CHANGED, mark);
    if (own[mine].text !== peer[theirs].text) markWords(frame, peer[theirs].text, mark);
    const pictures = [...frame.querySelectorAll(PICTURES)];
    markObjects(pictures, own[mine].pictures, peer[theirs].pictures, mark);
    const charts = (slides.charts[mine] ?? []).map((chart) => chart.getDom());
    markObjects(charts, own[mine].charts, peer[theirs].charts, mark);
  }

  // Stand-ins go before the next slide; the slides themselves stay where they are.
  let next: HTMLElement | null = null;
  for (let index = elements.length - 1; index >= 0; index--) {
    if (standIns.includes(elements[index])) deck.insertBefore(elements[index], next);
    next = elements[index];
  }

  const identity = elements.map((_, index) => index);
  const tops = () =>
    stops.map((stop) => scrollTopOf(context.viewport, stop.getBoundingClientRect().top));
  return {
    count: stops.length,
    go: (direction) => revealByTops(context.viewport, tops(), direction),
    anchor: () => scrollAnchor(context.viewport, elements, identity),
    scrollTo: (anchor) => scrollToAnchor(context.viewport, elements, anchor),
    dispose: () => {
      for (const standIn of standIns) standIn.remove();
      clearMarks(deck, CLASSES);
    },
  };
}

/** Outlines the pictures or charts that differ from the other side's at the same position. */
function markObjects(
  elements: readonly Element[],
  mine: readonly string[],
  theirs: readonly string[],
  className: string,
): void {
  elements.forEach((element, index) => {
    if (mine[index] === theirs[index]) return;
    // An outline doesn't show on a picture inside a drawing, so the drawing gets it.
    const target =
      element instanceof SVGImageElement ? (element.ownerSVGElement ?? element) : element;
    target.classList.add(MARK, OBJECT, className);
  });
}

function pictureUrl(picture: Element): string {
  return picture instanceof HTMLImageElement
    ? picture.currentSrc || picture.src
    : (picture.getAttribute('href') ?? picture.getAttribute('xlink:href') ?? '');
}

/**
 * The picture's size and a hash of it scaled down to a few pixels: enough to tell a replaced
 * picture, and the same for the same picture on both sides, which decode it alike.
 */
async function fingerprintPicture(url: string): Promise<string> {
  const picture = new Image();
  picture.src = url;
  try {
    await picture.decode();
  } catch {
    return '';
  }
  const size = `${picture.naturalWidth}×${picture.naturalHeight}`;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return size;
  try {
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    let hash = 0x811c9dc5;
    for (const byte of context.getImageData(0, 0, canvas.width, canvas.height).data) {
      hash = Math.imul(hash ^ byte, 0x01000193);
    }
    return `${size}:${(hash >>> 0).toString(36)}`;
  } catch {
    return size;
  }
}

interface ChartOption {
  xAxis?: { data?: unknown }[];
  yAxis?: { data?: unknown }[];
  series?: { name?: unknown; data?: unknown }[];
}

/** A chart's categories and values, leaving out how it's drawn. */
function chartData(chart: SlideChart): string {
  const option = chart.getOption() as ChartOption;
  const values = (data: unknown) =>
    Array.isArray(data)
      ? data.map((item: unknown) =>
          item && typeof item === 'object' && 'value' in item
            ? [(item as { name?: unknown }).name, item.value]
            : item,
        )
      : data;
  return JSON.stringify([
    option.xAxis?.map((axis) => axis.data),
    option.yAxis?.map((axis) => axis.data),
    option.series?.map((series) => [series.name, values(series.data)]),
  ]);
}

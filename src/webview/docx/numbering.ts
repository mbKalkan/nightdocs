import { CONTINUED } from './pageBreaks';

/** A level of a list, as docx-preview parses it (`numberingPart.domNumberings`). */
export interface NumberingLevel {
  /** The list (Word's numId). */
  id: string;
  level: number;
  start?: number;
  /** How the number reads, with `%1`…`%9` for the counts of the levels. */
  levelText?: string;
  format?: string;
  /** What follows the number: `tab` (the default), `space` or `nothing`. */
  suff?: string;
  /** A picture bullet, which docx-preview draws without counting. */
  bullet?: unknown;
}

/** The class docx-preview gives a paragraph of a list: `docx-num-<list>-<level>`. */
const LIST_CLASS = /^docx-num-(.+)-(\d+)$/;

/** CSS list styles for Word's number formats, as docx-preview maps them; others count 1, 2, 3. */
const FORMATS: Record<string, string> = {
  none: 'none',
  bullet: 'disc',
  decimal: 'decimal',
  lowerLetter: 'lower-alpha',
  upperLetter: 'upper-alpha',
  lowerRoman: 'lower-roman',
  upperRoman: 'upper-roman',
  decimalZero: 'decimal-leading-zero',
};

const SUFFIXES: Record<string, string> = { tab: '\\9', space: '\\a0' };

const cssString = (text: string) => `"${text.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\a ')}"`;

/**
 * Writes on each numbered paragraph the number docx-preview's CSS counters show for it, so that
 * a copy of it shown in the other version of the document keeps that number without counting
 * there (see `p[data-nd-number]` in viewer.css). Counts as those styles do: each level from its
 * start, one per paragraph of the level, and a paragraph of a level restarts the level below; the
 * rest of a paragraph after a page break doesn't count.
 */
export function keepNumbers(root: HTMLElement, levels: readonly NumberingLevel[]): void {
  const counted = new Map<string, NumberingLevel>();
  for (const level of levels) {
    if (level.levelText !== undefined && !level.bullet) {
      counted.set(`${level.id}-${level.level}`, level);
    }
  }
  if (counted.size === 0) return;
  const counts = new Map<string, number>();
  const first = (key: string) => (counted.get(key)?.start ?? 1) - 1;
  const count = (key: string) => counts.get(key) ?? first(key);

  for (const paragraph of root.querySelectorAll<HTMLElement>('p')) {
    const match = [...paragraph.classList].map((name) => LIST_CLASS.exec(name)).find(Boolean);
    if (!match) continue;
    const [, list, depth] = match;
    const level = Number(depth);
    const below = `${list}-${level + 1}`;
    if (counted.has(below)) counts.set(below, first(below));
    const own = `${list}-${level}`;
    const definition = counted.get(own);
    if (!definition || paragraph.classList.contains(CONTINUED)) continue;
    counts.set(own, count(own) + 1);

    // docx-preview formats every level of the number in this level's format.
    const style = FORMATS[definition.format ?? ''] ?? 'decimal';
    const resets: string[] = [];
    const parts = definition.levelText!.split(/(%\d)/).map((part) => {
      const at = /^%(\d)$/.exec(part);
      if (!at) return part ? cssString(part) : '';
      const name = `nd-num-${Number(at[1]) - 1}`;
      resets.push(`${name} ${count(`${list}-${Number(at[1]) - 1}`)}`);
      return `counter(${name}, ${style})`;
    });
    const suffix = SUFFIXES[definition.suff ?? 'tab'];
    if (suffix) parts.push(`"${suffix}"`);
    paragraph.dataset.ndNumber = '';
    paragraph.style.setProperty('--nd-number', parts.filter(Boolean).join(' ') || '""');
    paragraph.style.setProperty('--nd-counters', resets.join(' ') || 'none');
  }
}

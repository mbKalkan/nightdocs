/** What VS Code puts between the two names in the tab of a side-by-side comparison. */
export const DIFF_LABEL_SEPARATOR = ' ↔ ';

export interface DiffCandidate {
  /** File name, as VS Code shows it in the tab label. */
  name: string;
  /** URI scheme: `file` for a file on disk, `git` for a version from Git, and so on. */
  scheme: string;
}

/**
 * Tells the original (left) side of a comparison from the modified (right) one. VS Code
 * doesn't say, and doesn't create the two viewers in a fixed order. The tab label names the
 * left file first; when both names are the same, as when Git compares a file with an older
 * version of itself, the file on disk is the newer side.
 */
export function orderSides<T>(
  first: T,
  second: T,
  describe: (candidate: T) => DiffCandidate,
  label: string,
): [original: T, modified: T] {
  const a = describe(first);
  const b = describe(second);
  const [left, right] = label.split(DIFF_LABEL_SEPARATOR);
  if (left !== right) {
    if (a.name === right && b.name === left) return [second, first];
    if (a.name === left && b.name === right) return [first, second];
  }
  if (a.scheme === 'file' && b.scheme !== 'file') return [second, first];
  return [first, second];
}

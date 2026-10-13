// Formulas as Excel shows them in the formula bar, from the way files store them.
import { columnName } from './refs';

const MAX_ROW = 1_048_576;
const MAX_COL = 16_384;
const REF = '#REF!';

// Each is tried where a token starts; the lookahead keeps function names like LOG10( and
// sheet names like Q3! from reading as cells.
const CELL = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(!.])/y;
const COLUMNS = /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w(!.])/y;
const ROWS = /(\$?)(\d+):(\$?)(\d+)(?![\w(!.])/y;
const NAME = /[A-Za-z_\\][\w.\\]*/y;
const NUMBER = /\d+(?:\.\d*)?(?:[Ee][+-]?\d+)?/y;
/** Prefixes files keep on functions newer than Excel 2007, and on LAMBDA parameters. */
const FUTURE_PREFIX = /^(?:_xl(?:fn|ws|pm)\.)+/;

/**
 * A stored formula as Excel shows it, moved by `rows` and `cols` when it is a shared formula
 * filled into another cell: relative references shift, `$` ones stay, and ones pushed off the
 * sheet become #REF!. Future-function prefixes like `_xlfn.` are dropped.
 */
export function displayFormula(formula: string, rows = 0, cols = 0): string {
  let out = '';
  let i = 0;
  const at = (pattern: RegExp) => {
    pattern.lastIndex = i;
    return pattern.exec(formula);
  };
  while (i < formula.length) {
    const char = formula[i];
    const previous = formula[i - 1] ?? '';
    // Text, quoted sheet names and structured references are copied as they are.
    if (char === '"' || char === "'") {
      const end = closingQuote(formula, i, char);
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    if (char === '[') {
      const end = closingBracket(formula, i);
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    if (/[\w.\\]/.test(previous)) {
      out += char;
      i++;
      continue;
    }
    let match: RegExpExecArray | null;
    if ((match = at(CELL))) {
      const column = shiftColumn(match[1], match[2], cols);
      const row = shiftRow(match[3], match[4], rows);
      const cell = column === REF || row === REF ? REF : column + row;
      // A range with both ends off the sheet is one #REF!, as Excel shows it.
      out = cell === REF && out.endsWith(`${REF}:`) ? out.slice(0, -1) : out + cell;
    } else if ((match = at(COLUMNS))) {
      out += span(shiftColumn(match[1], match[2], cols), shiftColumn(match[3], match[4], cols));
    } else if ((match = at(ROWS))) {
      out += span(shiftRow(match[1], match[2], rows), shiftRow(match[3], match[4], rows));
    } else if ((match = at(NAME))) {
      out += match[0].replace(FUTURE_PREFIX, '');
    } else if ((match = at(NUMBER))) {
      out += match[0];
    } else {
      out += char;
      i++;
      continue;
    }
    i += match[0].length;
  }
  return out;
}

function span(first: string, last: string): string {
  return first === REF || last === REF ? REF : `${first}:${last}`;
}

function shiftColumn(absolute: string, letters: string, by: number): string {
  if (absolute || by === 0) return absolute + letters;
  let col = 0;
  for (const letter of letters.toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64;
  const shifted = col - 1 + by;
  return shifted < 0 || shifted >= MAX_COL ? REF : columnName(shifted);
}

function shiftRow(absolute: string, digits: string, by: number): string {
  if (absolute || by === 0) return absolute + digits;
  const shifted = parseInt(digits, 10) + by;
  return shifted < 1 || shifted > MAX_ROW ? REF : String(shifted);
}

/** Index just past a quoted run; a doubled quote inside is an escaped one. */
function closingQuote(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === quote) {
      if (text[i + 1] !== quote) return i + 1;
      i++;
    }
    i++;
  }
  return text.length;
}

/** Index just past a bracketed run; structured references nest, as in `T[[#This Row],[A]]`. */
function closingBracket(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    // An apostrophe escapes the next character inside structured references.
    if (text[i] === "'") i++;
    else if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) return i + 1;
  }
  return text.length;
}

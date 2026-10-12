import * as SSF from 'ssf';
import { FORMAT_COLORS } from './model';

/** Excel's built-in number formats that files reference by id without defining them. */
const BUILT_IN: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'm/d/yyyy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
};

/**
 * Format codes for built-in ids. The short date (14) and date-time (22) formats follow the
 * user's locale in Excel, so they are derived from it here as well.
 */
export function builtInFormats(locale: string): Record<number, string> {
  const formats = { ...BUILT_IN };
  const shortDate = localeDatePattern(locale);
  if (shortDate) {
    formats[14] = shortDate;
    formats[22] = `${shortDate} h:mm`;
  }
  return formats;
}

function localeDatePattern(locale: string): string | undefined {
  try {
    // Single-digit day and month reveal whether the locale pads them.
    const parts = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(new Date(2001, 2, 5));
    return parts
      .map((part) => {
        switch (part.type) {
          case 'year':
            return 'yyyy';
          case 'month':
            return part.value.length > 1 ? 'mm' : 'm';
          case 'day':
            return part.value.length > 1 ? 'dd' : 'd';
          case 'literal':
            // Escape separators: a bare "." would read as a decimal point.
            return part.value.replace(/[^./\- ]/g, '').replace(/./g, (char) => '\\' + char);
          default:
            return '';
        }
      })
      .join('');
  } catch {
    return undefined;
  }
}

export interface Formatted {
  text: string;
  /** Index into FORMAT_COLORS, 0 when the format doesn't force a color. */
  color: number;
}

export function formatNumber(value: number, code: string, date1904: boolean): Formatted {
  let text: string;
  try {
    text = SSF.format(code, value, { date1904 });
  } catch {
    text = SSF.format('General', value);
  }
  return { text, color: sectionColor(code, value) };
}

export function formatText(value: string, code: string): string {
  // Only formats with a text section (containing @) change how text is shown.
  if (!code.includes('@')) {
    return value;
  }
  try {
    return SSF.format(code, value);
  } catch {
    return value;
  }
}

/** The `[Red]`-style color of the format section that applies to `value`. */
function sectionColor(code: string, value: number): number {
  if (!code.includes('[')) {
    return 0;
  }
  const sections = splitSections(code);
  const section =
    value > 0 || sections.length === 1
      ? sections[0]
      : value < 0
        ? sections[1]
        : (sections[2] ?? sections[0]);
  const match = /\[(black|blue|cyan|green|magenta|red|white|yellow)\]/i.exec(section ?? '');
  if (!match) {
    return 0;
  }
  const names = ['', 'black', 'blue', 'cyan', 'green', 'magenta', 'red', 'white', 'yellow'];
  const index = names.indexOf(match[1].toLowerCase());
  return index > 0 && index < FORMAT_COLORS.length ? index : 0;
}

function splitSections(code: string): string[] {
  const sections: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    if (char === '"') quoted = !quoted;
    if (char === '\\' && !quoted) {
      current += char + (code[++i] ?? '');
      continue;
    }
    if (char === ';' && !quoted) {
      sections.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  sections.push(current);
  return sections;
}

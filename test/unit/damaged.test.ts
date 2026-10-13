import { describe, expect, it } from 'vitest';
import { isDamaged } from '../../src/webview/damaged';

describe('isDamaged', () => {
  it('recognizes broken zips and XML that does not parse', () => {
    for (const message of [
      "Corrupted zip: can't find end of central directory",
      'Corrupted zip: missing 2558 bytes.',
      'End of data reached (data length = 4764, asked index = 4765). Corrupted zip ?',
      "Can't find end of central directory : is this a zip file ?",
      'This page contains the following errors:error on line 2 at column 6188',
      'error on line 9998 at column 8: Excessive node nesting.',
      'Workbook has no sheets',
      'Invalid string length',
    ]) {
      expect(isDamaged(new Error(message)), message).toBe(true);
    }
  });

  it('leaves other errors to the general message', () => {
    expect(isDamaged(new TypeError("Cannot read properties of null (reading 'childNodes')"))).toBe(
      false,
    );
    expect(isDamaged('Workbook closed')).toBe(false);
  });
});

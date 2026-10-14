import { describe, expect, it } from 'vitest';
import { detectContainer, formatForPath } from '../../src/shared/formats';

describe('formatForPath', () => {
  it('recognizes Word documents regardless of case', () => {
    expect(formatForPath('/docs/Report.docx')).toEqual({ format: 'docx', appName: 'Word' });
    expect(formatForPath('C:\\Docs\\REPORT.DOCX')?.format).toBe('docx');
  });

  it('recognizes Excel and PowerPoint files, macro-enabled ones included', () => {
    expect(formatForPath('/data/budget.xlsm')).toEqual({ format: 'xlsx', appName: 'Excel' });
    expect(formatForPath('/talks/Review.PPTX')).toEqual({ format: 'pptx', appName: 'PowerPoint' });
    expect(formatForPath('/talks/review.pptm')?.format).toBe('pptx');
    expect(formatForPath('/talks/review.ppsx')?.format).toBe('pptx');
  });

  it('recognizes templates and the other macro-enabled files', () => {
    expect(formatForPath('/docs/letter.dotx')).toEqual({ format: 'docx', appName: 'Word' });
    expect(formatForPath('/docs/letter.docm')?.format).toBe('docx');
    expect(formatForPath('/docs/letter.dotm')?.format).toBe('docx');
    expect(formatForPath('/data/budget.xltx')).toEqual({ format: 'xlsx', appName: 'Excel' });
    expect(formatForPath('/data/budget.xltm')?.format).toBe('xlsx');
    expect(formatForPath('/talks/deck.potx')).toEqual({ format: 'pptx', appName: 'PowerPoint' });
    expect(formatForPath('/talks/deck.potm')?.format).toBe('pptx');
    expect(formatForPath('/talks/deck.ppsm')?.format).toBe('pptx');
  });

  it('ignores unsupported and extensionless paths', () => {
    expect(formatForPath('/data/budget.xlsb')).toBeUndefined();
    expect(formatForPath('/docs/report.pdf')).toBeUndefined();
    expect(formatForPath('/docs/report')).toBeUndefined();
    expect(formatForPath('/docs.docx/report')).toBeUndefined();
  });
});

describe('detectContainer', () => {
  it('detects ZIP-based Office Open XML files', () => {
    expect(detectContainer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe('zip');
  });

  it('detects Compound File Binary containers', () => {
    const header = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00];
    expect(detectContainer(new Uint8Array(header))).toBe('cfb');
  });

  it('reports anything else as unknown', () => {
    expect(detectContainer(new TextEncoder().encode('hello'))).toBe('unknown');
    expect(detectContainer(new Uint8Array([0x50, 0x4b]))).toBe('unknown');
  });
});

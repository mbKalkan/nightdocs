import { describe, expect, it } from 'vitest';
import { detectContainer, formatForPath } from '../../src/shared/formats';

describe('formatForPath', () => {
  it('recognizes Word documents regardless of case', () => {
    expect(formatForPath('/docs/Report.docx')).toEqual({ format: 'docx', appName: 'Word' });
    expect(formatForPath('C:\\Docs\\REPORT.DOCX')?.format).toBe('docx');
  });

  it('ignores unsupported and extensionless paths', () => {
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

import { describe, expect, it } from 'vitest';
import { gitObject, lfsObjectId } from '../../src/extension/gitObject';

describe('gitObject', () => {
  it('reads staged versions from the index', () => {
    expect(gitObject('', 'docs/report.docx')).toBe(':docs/report.docx');
    expect(gitObject('~', 'docs/report.docx')).toBe(':docs/report.docx');
  });

  it('reads the sides of a merge conflict from their stage', () => {
    expect(gitObject('~2', 'report.docx')).toBe(':2:report.docx');
  });

  it('reads commits and branches as named', () => {
    expect(gitObject('HEAD', 'report.docx')).toBe('HEAD:report.docx');
    expect(gitObject('3f2a1c9', 'a b/report.docx')).toBe('3f2a1c9:a b/report.docx');
  });

  it('refuses a ref git would read as an option', () => {
    expect(gitObject('--output=x', 'report.docx')).toBeUndefined();
  });
});

describe('lfsObjectId', () => {
  const oid = 'a'.repeat(64);
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 12345\n`;

  it('finds the object a Git LFS pointer stands for', () => {
    expect(lfsObjectId(new TextEncoder().encode(pointer))).toBe(oid);
  });

  it('ignores anything else', () => {
    expect(lfsObjectId(new TextEncoder().encode('PK\u0003\u0004 a zip'))).toBeUndefined();
    expect(lfsObjectId(new Uint8Array(4096))).toBeUndefined();
  });
});

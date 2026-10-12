import type { DocumentFormat } from './protocol';

export interface FormatInfo {
  format: DocumentFormat;
  /** Desktop app that usually handles the format, used in "Open in …" labels. */
  appName: string;
}

const FORMATS: Readonly<Record<string, FormatInfo>> = {
  '.docx': { format: 'docx', appName: 'Word' },
};

export function formatForPath(path: string): FormatInfo | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/') || dot < path.lastIndexOf('\\')) {
    return undefined;
  }
  return FORMATS[path.slice(dot).toLowerCase()];
}

export type ContainerKind = 'zip' | 'cfb' | 'unknown';

/**
 * Office Open XML files are ZIP archives. Password-protected OOXML files and the
 * legacy binary formats (.doc/.xls/.ppt) are Compound File Binary containers instead.
 */
export function detectContainer(bytes: Uint8Array): ContainerKind {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return 'zip';
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return 'cfb';
  }
  return 'unknown';
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);
}

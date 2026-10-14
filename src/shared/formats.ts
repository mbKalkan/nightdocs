import type { DocumentFormat } from './protocol';

export interface FormatInfo {
  format: DocumentFormat;
  /** Desktop app that usually handles the format, used in "Open in …" labels. */
  appName: string;
}

/**
 * Templates (.dotx, .xltx, .potx) and macro-enabled files (.docm, .xlsm, .pptm, …) have the same
 * parts as their plain siblings; only the content type of the main part differs. Macros are
 * never run.
 */
const FORMATS: Readonly<Record<string, FormatInfo>> = {
  '.docx': { format: 'docx', appName: 'Word' },
  '.docm': { format: 'docx', appName: 'Word' },
  '.dotx': { format: 'docx', appName: 'Word' },
  '.dotm': { format: 'docx', appName: 'Word' },
  '.xlsx': { format: 'xlsx', appName: 'Excel' },
  '.xlsm': { format: 'xlsx', appName: 'Excel' },
  '.xltx': { format: 'xlsx', appName: 'Excel' },
  '.xltm': { format: 'xlsx', appName: 'Excel' },
  '.pptx': { format: 'pptx', appName: 'PowerPoint' },
  '.pptm': { format: 'pptx', appName: 'PowerPoint' },
  '.ppsx': { format: 'pptx', appName: 'PowerPoint' },
  '.ppsm': { format: 'pptx', appName: 'PowerPoint' },
  '.potx': { format: 'pptx', appName: 'PowerPoint' },
  '.potm': { format: 'pptx', appName: 'PowerPoint' },
};

/** File extensions the viewer opens, with the leading dot. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(FORMATS);

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

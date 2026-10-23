import type { DocumentFormat } from './protocol';

export interface FormatInfo {
  format: DocumentFormat;
  /**
   * The app that edits the format, used in "Open in …" labels and messages: Word, Excel or
   * PowerPoint, and for Markdown the name of the format itself (it is edited in VS Code).
   */
  appName: string;
}

/**
 * Templates (.dotx, .xltx, .potx) and macro-enabled files (.docm, .xlsm, .pptm, …) have the same
 * parts as their plain siblings; only the content type of the main part differs. Macros are
 * never run.
 */
const OFFICE_FORMATS: Readonly<Record<string, FormatInfo>> = {
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

/** `.mdc` is Markdown with front matter, as Cursor keeps its rules for AI assistants. */
const MARKDOWN_FORMATS: Readonly<Record<string, FormatInfo>> = {
  '.md': { format: 'md', appName: 'Markdown' },
  '.markdown': { format: 'md', appName: 'Markdown' },
  '.mdc': { format: 'md', appName: 'Markdown' },
};

const FORMATS: Readonly<Record<string, FormatInfo>> = { ...OFFICE_FORMATS, ...MARKDOWN_FORMATS };

/** Office file extensions, with the leading dot; the viewer is their default editor. */
export const OFFICE_EXTENSIONS: readonly string[] = Object.keys(OFFICE_FORMATS);

/** Markdown file extensions; VS Code's text editor stays their default, the viewer is an option. */
export const MARKDOWN_EXTENSIONS: readonly string[] = Object.keys(MARKDOWN_FORMATS);

/** File extensions the viewer opens, with the leading dot. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(FORMATS);

export function formatForPath(path: string): FormatInfo | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/') || dot < path.lastIndexOf('\\')) {
    return undefined;
  }
  return FORMATS[path.slice(dot).toLowerCase()];
}

/** Formats stored as text, which VS Code itself edits, rather than as Office containers. */
export function isTextFormat(format: DocumentFormat): boolean {
  return format === 'md';
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

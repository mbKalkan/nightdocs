// Where links and pictures written in a Markdown file point. Plain path strings, without Node's
// `path`, so this runs in VS Code for the Web too.

export interface ResolvedHref {
  /** The target's path, in the same form as a URI's path (`/c:/docs/guide.md`). */
  path: string;
  /** What followed `#`, decoded. */
  fragment?: string;
}

/** Schemes a link can name that open outside VS Code, in the browser or the mail app. */
export function isExternalLink(href: string): boolean {
  return /^(https?|mailto):/i.test(href);
}

/** Any `scheme:` prefix, including `file:`; a Windows drive letter isn't one. */
export function hasScheme(href: string): boolean {
  return /^[a-z][a-z0-9+.-]+:/i.test(href);
}

/**
 * Resolves a relative link or picture path against the Markdown file at `documentPath`. A path
 * starting with `/` is relative to `rootPath`, the workspace folder, as GitHub takes it relative
 * to the repository. Returns undefined for links with a scheme and for an empty link.
 */
export function resolveHref(
  documentPath: string,
  href: string,
  rootPath = '',
): ResolvedHref | undefined {
  if (hasScheme(href)) return undefined;
  const hash = href.indexOf('#');
  const fragment = hash >= 0 ? decode(href.slice(hash + 1)) : undefined;
  const path = decode((hash >= 0 ? href.slice(0, hash) : href).split('?')[0].trim());
  if (!path) return fragment ? { path: documentPath, fragment } : undefined;
  const base = path.startsWith('/')
    ? rootPath
    : documentPath.slice(0, documentPath.lastIndexOf('/'));
  return { path: normalize(`${base}/${path}`), fragment: fragment || undefined };
}

/** Resolves `.` and `..`; never climbs above the root. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** `L12` or `L12-L20` (GitHub's line links), as 0-based lines, end inclusive. */
export function lineFragment(fragment: string | undefined): [number, number] | undefined {
  const match = fragment && /^L([1-9]\d*)(?:-L?([1-9]\d*))?$/i.exec(fragment);
  if (!match) return undefined;
  const start = Number(match[1]) - 1;
  return [start, match[2] ? Number(match[2]) - 1 : start];
}

const PICTURE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

/** The media type of a picture by its extension, or undefined for files that aren't one. */
export function pictureType(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? PICTURE_TYPES[name.slice(dot + 1).toLowerCase()] : undefined;
}

import { describe, expect, it } from 'vitest';
import {
  hasScheme,
  isExternalLink,
  lineFragment,
  pictureType,
  resolveHref,
} from '../../src/extension/markdownLinks';
import { splitHighlightedLines } from '../../src/webview/md/code';

const doc = '/c:/repo/docs/guide.md';

describe('resolveHref', () => {
  it('resolves paths next to the file and above it', () => {
    expect(resolveHref(doc, 'images/flow.svg')).toEqual({ path: '/c:/repo/docs/images/flow.svg' });
    expect(resolveHref(doc, './setup.md#install')).toEqual({
      path: '/c:/repo/docs/setup.md',
      fragment: 'install',
    });
    expect(resolveHref(doc, '../README.md')).toEqual({ path: '/c:/repo/README.md' });
  });

  it('takes a leading slash from the workspace folder, as GitHub does from the repository', () => {
    expect(resolveHref(doc, '/CONTRIBUTING.md', '/c:/repo')).toEqual({
      path: '/c:/repo/CONTRIBUTING.md',
    });
  });

  it('decodes escapes and drops queries', () => {
    expect(resolveHref(doc, 'my%20file.png?raw=true')).toEqual({
      path: '/c:/repo/docs/my file.png',
    });
  });

  it('keeps a fragment of the file itself', () => {
    expect(resolveHref(doc, '#usage')).toEqual({ path: doc, fragment: 'usage' });
    expect(resolveHref(doc, '')).toBeUndefined();
  });

  it('leaves links with a scheme to the caller', () => {
    expect(resolveHref(doc, 'https://example.com')).toBeUndefined();
    expect(resolveHref(doc, 'command:workbench.action.quit')).toBeUndefined();
  });
});

describe('link helpers', () => {
  it('tells web and mail links from others', () => {
    expect(isExternalLink('https://example.com')).toBe(true);
    expect(isExternalLink('mailto:a@b.c')).toBe(true);
    expect(isExternalLink('vscode:extension/x')).toBe(false);
    expect(hasScheme('command:x')).toBe(true);
    expect(hasScheme('c:/files/a.md')).toBe(false);
  });

  it("reads GitHub's line links", () => {
    expect(lineFragment('L12')).toEqual([11, 11]);
    expect(lineFragment('L12-L20')).toEqual([11, 19]);
    expect(lineFragment('install')).toBeUndefined();
    // Lines count from 1; a link to line 0 is no line.
    expect(lineFragment('L0')).toBeUndefined();
    expect(lineFragment('L0-L5')).toBeUndefined();
  });

  it('knows picture types by extension', () => {
    expect(pictureType('/a/logo.SVG')).toBe('image/svg+xml');
    expect(pictureType('/a/photo.jpeg')).toBe('image/jpeg');
    expect(pictureType('/a/notes.md')).toBeUndefined();
    expect(pictureType('/a/.png')).toBeUndefined();
  });
});

describe('splitHighlightedLines', () => {
  it('closes and reopens spans that run over a line break', () => {
    expect(
      splitHighlightedLines('a <span class="c">/* one\ntwo */</span> b\n<span class="k">x</span>'),
    ).toEqual([
      'a <span class="c">/* one</span>',
      '<span class="c">two */</span> b',
      '<span class="k">x</span>',
    ]);
  });

  it('keeps empty lines', () => {
    expect(splitHighlightedLines('a\n\nb')).toEqual(['a', '', 'b']);
  });
});

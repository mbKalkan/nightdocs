import { describe, expect, it } from 'vitest';
import { splitFrontMatter } from '../../src/webview/md/frontmatter';

describe('splitFrontMatter', () => {
  it('reads YAML properties in the order written, dates as written', () => {
    const { frontMatter } = splitFrontMatter(
      '---\nname: reviewer\ntools: Read, Grep\nupdated: 2026-10-23\n---\n# Title\n',
    );
    expect(frontMatter?.language).toBe('yaml');
    expect(frontMatter?.data).toEqual({
      name: 'reviewer',
      tools: 'Read, Grep',
      updated: '2026-10-23',
    });
    expect(Object.keys(frontMatter?.data ?? {})).toEqual(['name', 'tools', 'updated']);
    expect(frontMatter?.lineCount).toBe(5);
  });

  it('keeps line numbers by leaving the front matter blank in the body', () => {
    const text = '---\na: 1\n---\n# Title\n';
    const { body } = splitFrontMatter(text);
    expect(body.split('\n')).toHaveLength(text.split('\n').length);
    expect(body.split('\n')[3]).toBe('# Title');
  });

  it('knows the line each top-level property starts on', () => {
    const { frontMatter } = splitFrontMatter(
      '---\nname: x\n# a comment\ndescription: >-\n  long\n  text\n"quoted key": 1\nlist:\n  - a\n---\n',
    );
    expect([...(frontMatter?.keyLines ?? [])]).toEqual([
      ['name', 1],
      ['description', 3],
      ['quoted key', 6],
      ['list', 7],
    ]);
  });

  it('reports YAML that does not parse, with the line in the file', () => {
    const { frontMatter } = splitFrontMatter('---\nname: x\ntools: [Read, Grep\nmodel: y\n---\n');
    expect(frontMatter?.data).toBeUndefined();
    expect(frontMatter?.error?.message).toBeTruthy();
    expect(frontMatter?.error?.line).toBeGreaterThanOrEqual(2);
  });

  it('reports YAML that is not a set of properties', () => {
    const { frontMatter } = splitFrontMatter('---\n- a\n- b\n---\n');
    expect(frontMatter?.data).toBeUndefined();
    expect(frontMatter?.error?.message).toMatch(/properties/);
  });

  it('takes an empty block, or one of comments, as no properties', () => {
    expect(splitFrontMatter('---\n---\ntext').frontMatter?.data).toEqual({});
    expect(splitFrontMatter('---\n# draft\n\n---\ntext').frontMatter?.data).toEqual({});
  });

  it('shows TOML front matter without parsing it', () => {
    const { frontMatter } = splitFrontMatter('+++\ntitle = "x"\n+++\nbody');
    expect(frontMatter?.language).toBe('toml');
    expect(frontMatter?.source).toBe('title = "x"');
    expect(frontMatter?.data).toBeUndefined();
  });

  it('leaves a file alone without a closing fence or with --- further down', () => {
    expect(splitFrontMatter('---\nnot closed\n').frontMatter).toBeUndefined();
    expect(splitFrontMatter('# Title\n---\na: 1\n---\n').frontMatter).toBeUndefined();
  });

  it('accepts ... as the end of YAML', () => {
    expect(splitFrontMatter('---\na: 1\n...\nbody').frontMatter?.data).toEqual({ a: 1 });
  });
});

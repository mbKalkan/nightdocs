import { describe, expect, it } from 'vitest';
import { createParser, isBalanced, slugger } from '../../src/webview/md/parse';

const md = createParser();
const render = (text: string) => md.render(text);

describe('Markdown parser', () => {
  it('puts the source lines on blocks, end exclusive', () => {
    const html = render('# Title\n\nFirst line\nsecond line\n\n- item\n');
    expect(html).toContain('<h1 data-anchor="title" data-line="0" data-line-end="1">');
    expect(html).toContain('<p data-line="2" data-line-end="4">');
    expect(html).toContain('<li data-line="5" data-line-end="6">');
  });

  it('keeps the paragraphs of tight list items as elements', () => {
    expect(render('- one\n- two\n')).toMatch(/<li[^>]*><p [^>]*class="md-tight">one<\/p><\/li>/);
  });

  it('puts each line of code in its own element, with its line', () => {
    const html = render('text\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n');
    expect(html).toContain('<div class="md-code" data-line="2" data-line-end="6" data-lang="ts">');
    expect(html).toContain(
      '<span class="md-line" data-line="3" data-line-end="4">const a = 1;\n</span>',
    );
    expect(html).toContain(
      '<span class="md-line" data-line="4" data-line-end="5">const b = 2;\n</span>',
    );
  });

  it('escapes code', () => {
    expect(render('```\n<script>alert(1)</script>\n```\n')).toContain('&lt;script&gt;');
  });

  it('turns task list items into boxes', () => {
    const html = render('- [x] done\n- [ ] to do\n- plain\n');
    expect(html).toContain('<span class="md-task-box" data-checked="true"></span>done');
    expect(html).toContain('<span class="md-task-box" data-checked="false"></span>to do');
    expect(html.match(/class="md-task"/g)).toHaveLength(2);
  });

  it("renders GitHub's alerts with a title", () => {
    const html = render('> [!WARNING]\n> Careful now.\n');
    expect(html).toContain('<blockquote class="md-alert md-alert-warning"');
    expect(html).toContain('<p class="md-alert-title" data-alert="warning">Warning</p>');
    expect(html).toContain('Careful now.');
    expect(html).not.toContain('[!WARNING]');
  });

  it('renders an alert whose text follows in its own paragraph', () => {
    const html = render('> [!TIP]\n>\n> Use the shortcut.\n');
    expect(html).toContain('data-alert="tip"');
    expect(html).toContain('Use the shortcut.');
  });

  it('leaves quotes that only look like alerts alone', () => {
    expect(render('> [!NOTE] inline text\n')).not.toContain('md-alert');
    expect(render('> [!UNKNOWN]\n> text\n')).not.toContain('md-alert');
  });

  it('frames the content between prompt tags, which a browser would hide', () => {
    const html = render('Intro\n<example>\nuser: hi\n</example>\n');
    expect(html).toContain('<p data-line="0" data-line-end="1">Intro</p>');
    expect(html).toContain('<div class="md-xml" data-tag="example">');
    expect(html).toContain('&lt;example&gt;</div><div class="md-xml-body">');
    expect(html).toContain('<p data-line="2" data-line-end="3">user: hi</p>');
    expect(html).toContain('&lt;/example&gt;</div></div>');
  });

  it('shows unpaired and self-closing prompt tags as they are written', () => {
    const html = render('<rules strict="true" />\n\n</orphan>\n');
    expect(html).toContain('&lt;rules strict=&quot;true&quot; /&gt;');
    expect(html).toContain('&lt;/orphan&gt;');
    expect(html).not.toContain('class="md-xml"');
  });

  it('pairs prompt tags only within the same container', () => {
    const html = render('- <a1>\n  <x>\n- </x>\n');
    expect(html).not.toContain('class="md-xml"');
  });

  it('shows inline tags HTML does not know, and passes on those it knows', () => {
    const html = render('Answer in <answer> tags, <b>bold</b>.\n');
    expect(html).toContain('<code class="md-xml-inline">&lt;answer&gt;</code>');
    expect(html).toContain('<b>bold</b>');
  });

  it('frames balanced HTML blocks and marks the lines of unbalanced ones', () => {
    expect(render('<p align="center">Logo</p>\n')).toContain(
      '<div class="md-html" data-line="0" data-line-end="1"><p align="center">Logo</p>',
    );
    const details = render('<details>\n<summary>More</summary>\n\nText\n\n</details>\n');
    expect(details).toMatch(
      /^<span class="md-html-line" data-line="0" data-line-end="2"><\/span><details>/,
    );
    expect(details).toContain('<p data-line="3" data-line-end="4">Text</p>');
  });

  it('turns table alignment into classes', () => {
    const html = render('| a | b |\n| :-: | --: |\n| 1 | 2 |\n');
    expect(html).toContain('<th class="md-align-center">a</th>');
    expect(html).toContain('<td class="md-align-right">2</td>');
    expect(html).not.toContain('style=');
    expect(html).toMatch(/<div class="md-table" data-line="0" data-line-end="3"><table>/);
  });

  it('numbers footnotes without brackets', () => {
    const html = render('Text[^1].\n\n[^1]: Note.\n');
    expect(html).toMatch(/<a href="#fn1" id="fnref1">1<\/a>/);
  });

  it('keeps quotes and dashes as typed', () => {
    expect(render('"quoted" -- dash\n')).toContain('&quot;quoted&quot; -- dash');
  });
});

describe('slugger', () => {
  it('makes GitHub heading ids, numbering repeats', () => {
    const slug = slugger();
    expect(slug('Getting Started!')).toBe('getting-started');
    expect(slug('Getting Started')).toBe('getting-started-1');
    expect(slug('Getting Started')).toBe('getting-started-2');
    expect(slug('Çalışma Alanı')).toBe('çalışma-alanı');
    expect(slug('`code` & more')).toBe('code--more');
  });
});

describe('isBalanced', () => {
  it('tells HTML that closes what it opens', () => {
    expect(isBalanced('<p align="center"><img src="a.png"><br></p>')).toBe(true);
    expect(isBalanced('<!-- <div> -->')).toBe(true);
    expect(isBalanced('<details>\n<summary>x</summary>')).toBe(false);
    expect(isBalanced('</div>')).toBe(false);
  });
});

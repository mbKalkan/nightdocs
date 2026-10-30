import { describe, expect, it } from 'vitest';
import {
  CONTINUED,
  splitAtPageBreaks,
  splitParagraph,
  type ParsedElement,
} from '../../src/webview/docx/pageBreaks';

const text = (value: string): ParsedElement => ({ type: 'text', text: value });
const saved: ParsedElement = { type: 'break', break: 'lastRenderedPageBreak' };
const page: ParsedElement = { type: 'break', break: 'page' };
const run = (...children: ParsedElement[]): ParsedElement => ({ type: 'run', children });
const paragraph = (...children: ParsedElement[]): ParsedElement => ({
  type: 'paragraph',
  children,
});

/** The text of each part, and how it starts. */
const parts = (list: ParsedElement[]) =>
  list.map((part) => ({
    text:
      JSON.stringify(part.children)
        .match(/"text":"[^"]*"/g)
        ?.join('') ?? '',
    before: part.pageBreakBefore ?? false,
    continued: part.className?.includes(CONTINUED) ?? false,
  }));

describe('splitParagraph', () => {
  it('turns a saved break at the start into a page break before the paragraph', () => {
    // A numbered clause Word last laid out at the top of a page: docx-preview made an empty
    // numbered paragraph of the part before the break, so every later clause was off by one.
    const bookmark: ParsedElement = { type: 'bookmarkStart' };
    const result = splitParagraph(paragraph(bookmark, run(saved, text('PRE-EMPTIVE RIGHT'))));
    expect(parts(result)).toEqual([
      { text: '"text":"PRE-EMPTIVE RIGHT"', before: true, continued: false },
    ]);
    expect(JSON.stringify(result)).not.toContain('lastRenderedPageBreak');
    expect(result[0]!.children![0]).toBe(bookmark);
  });

  it('does the same for an explicit page break at the start', () => {
    const result = splitParagraph(paragraph(run(page), run(text('Next'))));
    expect(parts(result)).toEqual([{ text: '"text":"Next"', before: true, continued: false }]);
  });

  it('marks the part after a break in the middle as continued', () => {
    const source = paragraph(run(text('one ')), run(text('two'), saved, text('three')));
    source.sectionProps = { id: 'section' };
    const [first, rest, ...more] = splitParagraph(source);
    expect(more).toEqual([]);
    expect(parts([first!, rest!])).toEqual([
      { text: '"text":"one ""text":"two"', before: false, continued: false },
      { text: '"text":"three"', before: false, continued: true },
    ]);
    // The first part ends with the break, so docx-preview ends the page there without copying.
    expect(first!.children!.at(-1)!.children!.at(-1)).toBe(saved);
    // A section break belongs to the end of the paragraph only.
    expect(first!.sectionProps).toBeUndefined();
    expect(rest!.sectionProps).toEqual({ id: 'section' });
  });

  it('splits at every break', () => {
    const result = splitParagraph(
      paragraph(run(saved, text('a')), run(text('b'), page, text('c'), saved, text('d'))),
    );
    expect(parts(result)).toEqual([
      { text: '"text":"a""text":"b"', before: true, continued: false },
      { text: '"text":"c"', before: false, continued: true },
      { text: '"text":"d"', before: false, continued: true },
    ]);
  });

  it('leaves paragraphs that docx-preview splits cleanly alone', () => {
    const empty = paragraph(run(page));
    expect(splitParagraph(empty)).toEqual([empty]);
    const ending = paragraph(run(text('end'), saved), { type: 'bookmarkEnd' });
    expect(splitParagraph(ending)).toEqual([ending]);
    const plain = paragraph(run(text('plain')));
    expect(splitParagraph(plain)).toEqual([plain]);
    // A line break is not a page break.
    const lines = paragraph(run(text('a'), { type: 'break', break: 'textWrapping' }, text('b')));
    expect(splitParagraph(lines)).toEqual([lines]);
  });

  it('keeps a class the paragraph already has', () => {
    const source = { ...paragraph(run(text('a'), page, text('b'))), className: 'own' };
    expect(splitParagraph(source)[1]!.className).toBe(`own ${CONTINUED}`);
  });
});

describe('splitAtPageBreaks', () => {
  it('splits the paragraphs of the body and leaves tables alone', () => {
    const table: ParsedElement = { type: 'table', children: [paragraph(run(saved, text('x')))] };
    const document = {
      documentPart: { body: { children: [paragraph(run(text('a'), saved, text('b'))), table] } },
    };
    splitAtPageBreaks(document);
    expect(document.documentPart.body.children).toHaveLength(3);
    expect(document.documentPart.body.children[2]).toBe(table);
  });

  it('ignores a document without a body', () => {
    expect(() => splitAtPageBreaks(undefined)).not.toThrow();
    expect(() => splitAtPageBreaks({ documentPart: {} })).not.toThrow();
  });
});

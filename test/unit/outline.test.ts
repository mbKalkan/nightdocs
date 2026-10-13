import { describe, expect, it } from 'vitest';
import { headingClasses } from '../../src/webview/docx/outline';

const styles = (...list: object[]) => ({ stylesPart: { styles: list } });

describe('headingClasses', () => {
  it('finds the built-in heading styles by name, whatever their id', () => {
    const classes = headingClasses(
      styles(
        { id: 'Heading1', name: 'heading 1', target: 'p' },
        // A Turkish Word names the style the same way but gives it another id.
        { id: 'Balk2', name: 'heading 2', target: 'p' },
        { id: 'Normal', name: 'Normal', target: 'p' },
      ),
    );
    expect([...classes]).toEqual([
      ['docx_heading1', 1],
      ['docx_balk2', 2],
    ]);
  });

  it('takes outline levels set on a style or on the style it is based on', () => {
    const classes = headingClasses(
      styles(
        { id: 'Chapter', name: 'Chapter', target: 'p', paragraphProps: { outlineLevel: 0 } },
        { id: 'Chapter Title', name: 'Chapter Title', target: 'p', basedOn: 'Chapter' },
        // Level 9 is body text.
        { id: 'Body', name: 'Body', target: 'p', paragraphProps: { outlineLevel: 9 } },
        // Character styles don't make headings.
        { id: 'Heading1Char', name: 'heading 1', target: 'span' },
      ),
    );
    expect([...classes]).toEqual([
      ['docx_chapter', 1],
      ['docx_chapter-title', 1],
    ]);
  });

  it('ignores a document without styles and loops in based-on styles', () => {
    expect(headingClasses(undefined).size).toBe(0);
    const looped = headingClasses(
      styles(
        { id: 'A', name: 'A', target: 'p', basedOn: 'B' },
        { id: 'B', name: 'B', target: 'p', basedOn: 'A' },
      ),
    );
    expect(looped.size).toBe(0);
  });
});

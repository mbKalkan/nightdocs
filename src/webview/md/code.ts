/** Code blocks larger than this aren't highlighted, so a huge file still opens at once. */
const MAX_HIGHLIGHT = 100_000;

/**
 * Splits highlighted HTML into lines, closing the spans still open at the end of a line and
 * opening them again on the next, so a token spanning lines (a comment, a string) stays colored.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  for (const [, opening, closing, newline, text] of html.matchAll(
    /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+)/g,
  )) {
    if (opening) {
      open.push(opening);
      line += opening;
    } else if (closing) {
      open.pop();
      line += closing;
    } else if (newline) {
      lines.push(line + '</span>'.repeat(open.length));
      line = open.join('');
    } else {
      line += text;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Colors the code blocks of `root` whose language is known. The highlighter is loaded the first
 * time a document has such a block.
 */
export async function highlightCode(root: ParentNode): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('.md-code[data-lang]')].filter(
    (block) => block.dataset.lang && block.dataset.lang !== 'mermaid',
  );
  if (blocks.length === 0) return;
  const { highlight } = await import('./hljs');
  for (const block of blocks) {
    const lines = [...block.querySelectorAll<HTMLElement>('.md-line')];
    const code = lines.map((line) => line.textContent?.replace(/\n$/, '') ?? '').join('\n');
    if (code.length > MAX_HIGHLIGHT) continue;
    const html = highlight(code, block.dataset.lang!.toLowerCase());
    if (html === undefined) continue;
    const highlighted = splitHighlightedLines(html);
    if (highlighted.length !== lines.length) continue;
    // The highlighter escapes the code; its markup is only spans with classes.
    lines.forEach((line, i) => (line.innerHTML = `${highlighted[i]}\n`));
  }
}

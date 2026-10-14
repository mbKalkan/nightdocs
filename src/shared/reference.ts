/**
 * A copied reference names the file, then the place in it, then what is there, so that it reads
 * well when pasted into a chat with an AI assistant or into a note:
 *
 *     docs/report.docx, page 3, under "Regional results":
 *     > North grew 11.7% over the quarter.
 */
export function composeReference(file: string, location: string, text?: string): string {
  const head = `${file}, ${location}`;
  return text ? `${head}:\n${text}` : head;
}

/** Prose quoted the Markdown way: `> ` before each line, blank lines dropped. */
export function quote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `> ${line}`)
    .join('\n');
}

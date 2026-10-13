// Messages of errors that mean the file itself is broken, not the viewer: a zip that is
// truncated or isn't one (JSZip), XML that doesn't parse (DOMParser, our own parsers), and
// sizes no real document has, as in files made to exhaust memory.
const DAMAGED =
  /corrupted zip|end of data reached|end of central directory|is this a zip file|invalid signature|following errors|excessive node nesting|missing workbook part|workbook has no sheets|invalid string length|invalid typed array length|array buffer allocation failed/i;

/** Whether an error while rendering means the file is damaged, so saying so helps more. */
export function isDamaged(error: unknown): boolean {
  return DAMAGED.test(error instanceof Error ? error.message : String(error));
}

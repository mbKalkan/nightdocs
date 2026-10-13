// Parses workbooks off the UI thread. Bundled separately and embedded as a string (see
// scripts/build.mjs), then started from a blob URL.
import type { WorkbookSummary } from '../../shared/protocol';
import type { SheetData } from './model';
import { openWorkbook, type OpenedWorkbook } from './parse';
import { sheetRows } from './summary';

export type WorkerRequest =
  | { id: number; type: 'open'; bytes: Uint8Array; locale: string }
  | { id: number; type: 'sheet'; index: number }
  | { id: number; type: 'summary' };

export type WorkerResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

let workbook: OpenedWorkbook | undefined;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'open') {
      workbook = await openWorkbook(request.bytes, request.locale);
      reply({ id: request.id, ok: true, result: workbook.info });
    } else if (request.type === 'sheet') {
      if (!workbook) throw new Error('No workbook open');
      const sheet = await workbook.readSheet(request.index);
      reply({ id: request.id, ok: true, result: sheet }, transferables(sheet));
    } else {
      if (!workbook) throw new Error('No workbook open');
      reply({ id: request.id, ok: true, result: await summarize(workbook) });
    }
  } catch (error) {
    reply({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/** The visible sheets' values, for comparing two versions; reads every sheet. */
async function summarize(opened: OpenedWorkbook): Promise<WorkbookSummary> {
  const sheets = [];
  for (const [index, sheet] of opened.info.sheets.entries()) {
    if (!sheet.hidden) {
      sheets.push({ name: sheet.name, rows: sheetRows(await opened.readSheet(index)) });
    }
  }
  return { format: 'xlsx', sheets };
}

function reply(message: WorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

function transferables(sheet: SheetData): Transferable[] {
  // A buffer listed twice fails the transfer, so dedupe in case pictures share one.
  const arrays = [
    sheet.rowStarts,
    sheet.cellCols,
    sheet.cellStyles,
    sheet.cellKinds,
    sheet.cellTexts,
    sheet.cellNumbers,
    sheet.cellFormatColors,
    sheet.colWidths,
    sheet.rowHeights,
    sheet.merges,
    ...sheet.drawings.flatMap((drawing) => (drawing.image ? [drawing.image] : [])),
  ];
  return [...new Set(arrays.map((array) => array.buffer as ArrayBuffer))];
}

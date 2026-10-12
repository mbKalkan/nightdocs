// Parses workbooks off the UI thread. Bundled separately and embedded as a string (see
// scripts/build.mjs), then started from a blob URL.
import type { SheetData } from './model';
import { openWorkbook, type OpenedWorkbook } from './parse';

export type WorkerRequest =
  | { id: number; type: 'open'; bytes: Uint8Array; locale: string }
  | { id: number; type: 'sheet'; index: number };

export type WorkerResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

let workbook: OpenedWorkbook | undefined;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'open') {
      workbook = await openWorkbook(request.bytes, request.locale);
      reply({ id: request.id, ok: true, result: workbook.info });
    } else {
      if (!workbook) throw new Error('No workbook open');
      const sheet = await workbook.readSheet(request.index);
      reply({ id: request.id, ok: true, result: sheet }, transferables(sheet));
    }
  } catch (error) {
    reply({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

function reply(message: WorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

function transferables(sheet: SheetData): Transferable[] {
  return [
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
  ].map((array) => array.buffer as ArrayBuffer);
}

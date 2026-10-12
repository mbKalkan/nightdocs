import JSZip from 'jszip';
import { firstColor, readThemeColors, resolveColor } from './excelColors';
import {
  CellKind,
  type BorderSide,
  type CellStyle,
  type SheetData,
  type SheetInfo,
  type WorkbookInfo,
} from './model';
import { builtInFormats, formatNumber, formatText } from './numberFormat';
import { decodeEntities, elements, firstElement, textRuns } from './xml';

const REL_OFFICE_DOCUMENT = /\/officeDocument$/;
const REL_STYLES = /\/styles$/;
const REL_SHARED_STRINGS = /\/sharedStrings$/;
const REL_THEME = /\/theme$/;

/** Excel's maximum digit width for the default 11pt font, in pixels. */
const MAX_DIGIT_WIDTH = 7;
const POINTS_TO_PIXELS = 96 / 72;
/** Empty rows and columns shown past the data so a sheet looks like a sheet. */
const MIN_ROWS = 60;
const MIN_COLS = 26;

export interface OpenedWorkbook {
  info: WorkbookInfo;
  readSheet(index: number): Promise<SheetData>;
}

interface SheetEntry extends SheetInfo {
  path: string;
}

export async function openWorkbook(bytes: Uint8Array, locale: string): Promise<OpenedWorkbook> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (path: string | undefined) =>
    path ? ((await zip.file(path)?.async('string')) ?? undefined) : undefined;

  const rootRels = await relationships(read, '');
  const workbookPath =
    [...rootRels.values()].find((rel) => REL_OFFICE_DOCUMENT.test(rel.type))?.target ??
    'xl/workbook.xml';
  const workbookXml = await read(workbookPath);
  if (!workbookXml) {
    throw new Error('Missing workbook part');
  }
  const rels = await relationships(read, workbookPath);
  const relByType = (pattern: RegExp) =>
    [...rels.values()].find((rel) => pattern.test(rel.type))?.target;

  const pr = firstElement(workbookXml, 'workbookPr')?.attrs;
  const date1904 = pr?.date1904 === '1' || pr?.date1904 === 'true';
  const activeTab = parseInt(firstElement(workbookXml, 'workbookView')?.attrs.activeTab ?? '0', 10);

  const theme = readThemeColors(await read(relByType(REL_THEME)));
  const { styles, formats } = parseStyles(await read(relByType(REL_STYLES)), theme, locale);
  const sharedStrings = parseSharedStrings(await read(relByType(REL_SHARED_STRINGS)));

  const sheets: SheetEntry[] = [];
  const sheetsXml = firstElement(workbookXml, 'sheets')?.body ?? '';
  for (const sheet of elements(sheetsXml, 'sheet')) {
    const path = rels.get(sheet.attrs.id)?.target;
    if (path && zip.file(path)) {
      sheets.push({
        name: sheet.attrs.name ?? `Sheet${sheets.length + 1}`,
        hidden: sheet.attrs.state === 'hidden' || sheet.attrs.state === 'veryHidden',
        path,
      });
    }
  }
  if (sheets.length === 0) {
    throw new Error('Workbook has no sheets');
  }
  await Promise.all(
    sheets.map(async (sheet) => {
      sheet.tabColor = await readTabColor(zip, sheet.path, theme);
    }),
  );

  let activeSheet = Math.min(Math.max(activeTab, 0), sheets.length - 1);
  if (sheets[activeSheet].hidden) {
    activeSheet = Math.max(
      0,
      sheets.findIndex((sheet) => !sheet.hidden),
    );
  }

  return {
    info: {
      sheets: sheets.map(({ name, hidden, tabColor }) => ({ name, hidden, tabColor })),
      activeSheet,
      styles,
    },
    async readSheet(index) {
      const xml = await read(sheets[index]?.path);
      if (xml === undefined) {
        throw new Error(`Missing sheet ${index}`);
      }
      return parseSheet(xml, { sharedStrings, styles, formats, date1904 });
    },
  };
}

interface Relationship {
  type: string;
  target: string;
}

async function relationships(
  read: (path: string) => Promise<string | undefined>,
  partPath: string,
): Promise<Map<string, Relationship>> {
  const folder = partPath.slice(0, partPath.lastIndexOf('/') + 1);
  const relsPath = `${folder}_rels/${partPath.slice(folder.length)}.rels`;
  const xml = await read(relsPath);
  const result = new Map<string, Relationship>();
  for (const rel of elements(xml ?? '', 'Relationship')) {
    if (rel.attrs.TargetMode === 'External') continue;
    result.set(rel.attrs.Id, {
      type: rel.attrs.Type ?? '',
      target: resolvePath(folder, rel.attrs.Target ?? ''),
    });
  }
  return result;
}

function resolvePath(folder: string, target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1);
  }
  const parts = (folder + target).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.' && part !== '') resolved.push(part);
  }
  return resolved.join('/');
}

/** Reads just the start of a sheet part, where `<sheetPr><tabColor>` lives. */
async function readTabColor(
  zip: JSZip,
  path: string,
  theme: string[],
): Promise<string | undefined> {
  const file = zip.file(path);
  if (!file) return undefined;
  const head = await new Promise<string>((resolve) => {
    let text = '';
    // internalStream exists at runtime but is missing from JSZip's type definitions.
    const stream = (
      file as unknown as { internalStream(type: 'string'): ZipStream }
    ).internalStream('string');
    stream
      .on('data', (chunk: string) => {
        text += chunk;
        if (text.length > 2048) {
          stream.pause();
          resolve(text);
        }
      })
      .on('end', () => resolve(text))
      .on('error', () => resolve(text))
      .resume();
  });
  const sheetPr = firstElement(head, 'sheetPr');
  const tab = sheetPr && firstElement(sheetPr.body, 'tabColor');
  return tab ? resolveColor(tab.attrs, theme) : undefined;
}

interface ZipStream {
  on(event: 'data', listener: (chunk: string) => void): ZipStream;
  on(event: 'end' | 'error', listener: () => void): ZipStream;
  pause(): ZipStream;
  resume(): ZipStream;
}

function parseSharedStrings(xml: string | undefined): string[] {
  const strings: string[] = [];
  for (const item of elements(xml ?? '', 'si')) {
    strings.push(textRuns(item.body));
  }
  return strings;
}

function parseStyles(
  xml: string | undefined,
  theme: string[],
  locale: string,
): { styles: CellStyle[]; formats: string[] } {
  const source = xml ?? '';
  const codes: Record<number, string> = builtInFormats(locale);
  for (const fmt of elements(firstElement(source, 'numFmts')?.body ?? '', 'numFmt')) {
    codes[parseInt(fmt.attrs.numFmtId, 10)] = fmt.attrs.formatCode ?? 'General';
  }

  const fonts = [...elements(firstElement(source, 'fonts')?.body ?? '', 'font')].map((font) => {
    const flag = (name: string) => {
      const el = firstElement(font.body, name);
      return !!el && el.attrs.val !== '0' && el.attrs.val !== 'false';
    };
    const underline = firstElement(font.body, 'u');
    return {
      bold: flag('b'),
      italic: flag('i'),
      strike: flag('strike'),
      underline: !underline
        ? ('none' as const)
        : underline.attrs.val === 'double' || underline.attrs.val === 'doubleAccounting'
          ? ('double' as const)
          : underline.attrs.val === 'none'
            ? ('none' as const)
            : ('single' as const),
      size: parseFloat(firstElement(font.body, 'sz')?.attrs.val ?? '11') || 11,
      fontName: firstElement(font.body, 'name')?.attrs.val ?? 'Calibri',
      color: firstColor(font.body, theme),
    };
  });

  const fills = [...elements(firstElement(source, 'fills')?.body ?? '', 'fill')].map((fill) => {
    const pattern = firstElement(fill.body, 'patternFill');
    if (pattern) {
      const type = pattern.attrs.patternType;
      if (!type || type === 'none') return undefined;
      const fg = firstElement(pattern.body, 'fgColor');
      const bg = firstElement(pattern.body, 'bgColor');
      return resolveColor(fg?.attrs, theme) ?? resolveColor(bg?.attrs, theme);
    }
    const stop = firstElement(fill.body, 'stop');
    return stop ? firstColor(stop.body, theme) : undefined;
  });

  const borders = [...elements(firstElement(source, 'borders')?.body ?? '', 'border')].map(
    (border) => {
      const side = (...names: string[]): BorderSide | undefined => {
        for (const name of names) {
          const el = firstElement(border.body, name);
          if (el?.attrs.style && el.attrs.style !== 'none') {
            return { style: el.attrs.style, color: firstColor(el.body, theme) };
          }
        }
        return undefined;
      };
      return {
        top: side('top'),
        right: side('right', 'end'),
        bottom: side('bottom'),
        left: side('left', 'start'),
      };
    },
  );

  const styles: CellStyle[] = [];
  const formats: string[] = [];
  const defaultFont = fonts[0] ?? {
    bold: false,
    italic: false,
    strike: false,
    underline: 'none' as const,
    size: 11,
    fontName: 'Calibri',
    color: undefined,
  };
  for (const xf of elements(firstElement(source, 'cellXfs')?.body ?? '', 'xf')) {
    const font = fonts[parseInt(xf.attrs.fontId ?? '0', 10)] ?? defaultFont;
    const alignment = firstElement(xf.body, 'alignment')?.attrs ?? {};
    styles.push({
      ...font,
      fill: fills[parseInt(xf.attrs.fillId ?? '0', 10)],
      border: borders[parseInt(xf.attrs.borderId ?? '0', 10)] ?? {},
      horizontal: alignment.horizontal ?? 'general',
      vertical: alignment.vertical ?? 'bottom',
      wrap: alignment.wrapText === '1' || alignment.wrapText === 'true',
      indent: parseInt(alignment.indent ?? '0', 10) || 0,
    });
    formats.push(codes[parseInt(xf.attrs.numFmtId ?? '0', 10)] ?? 'General');
  }
  if (styles.length === 0) {
    styles.push({
      ...defaultFont,
      border: {},
      horizontal: 'general',
      vertical: 'bottom',
      wrap: false,
      indent: 0,
    });
    formats.push('General');
  }
  return { styles, formats };
}

interface SheetContext {
  sharedStrings: string[];
  styles: CellStyle[];
  formats: string[];
  date1904: boolean;
}

/** "AB12" → { row: 11, col: 27 } (0-based). */
export function parseCellRef(ref: string): { row: number; col: number } | undefined {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  if (!match) return undefined;
  let col = 0;
  for (const char of match[1].toUpperCase()) {
    col = col * 26 + (char.charCodeAt(0) - 64);
  }
  return { row: parseInt(match[2], 10) - 1, col: col - 1 };
}

export function parseSheet(xml: string, context: SheetContext): SheetData {
  const view = firstElement(xml, 'sheetView');
  const pane = view && firstElement(view.body, 'pane');
  const frozen = pane?.attrs.state === 'frozen' || pane?.attrs.state === 'frozenSplit';
  const format = firstElement(xml, 'sheetFormatPr')?.attrs ?? {};
  const defaultRowHeight = Math.round(
    (parseFloat(format.defaultRowHeight ?? '15') || 15) * POINTS_TO_PIXELS,
  );
  const defaultColWidth = format.defaultColWidth
    ? Math.round(parseFloat(format.defaultColWidth) * MAX_DIGIT_WIDTH + 5)
    : (parseFloat(format.baseColWidth ?? '8') || 8) * MAX_DIGIT_WIDTH + 8;

  const texts: string[] = [''];
  const textIndex = new Map<string, number>([['', 0]]);
  const intern = (text: string) => {
    let index = textIndex.get(text);
    if (index === undefined) {
      index = texts.length;
      texts.push(text);
      textIndex.set(text, index);
    }
    return index;
  };

  const rows: number[] = [];
  const cols: number[] = [];
  const styleIds: number[] = [];
  const kinds: number[] = [];
  const textIds: number[] = [];
  const numbers: number[] = [];
  const colors: number[] = [];
  const rowHeightOverrides = new Map<number, number>();

  const dataStart = xml.search(/<(?:[\w.-]+:)?sheetData[\s>]/);
  const dataEnd = xml.search(/<\/(?:[\w.-]+:)?sheetData>/);
  const sheetData = dataStart >= 0 && dataEnd > dataStart ? xml.slice(dataStart, dataEnd) : '';

  let ordered = true;
  let rowNumber = -1;
  for (const row of elements(sheetData, 'row')) {
    rowNumber = row.attrs.r ? parseInt(row.attrs.r, 10) - 1 : rowNumber + 1;
    if (row.attrs.hidden === '1' || row.attrs.hidden === 'true') {
      rowHeightOverrides.set(rowNumber, 0);
    } else if (row.attrs.ht) {
      rowHeightOverrides.set(rowNumber, Math.round(parseFloat(row.attrs.ht) * POINTS_TO_PIXELS));
    }
    let colNumber = -1;
    for (const cell of elements(row.body, 'c')) {
      const ref = cell.attrs.r ? parseCellRef(cell.attrs.r) : undefined;
      colNumber = ref ? ref.col : colNumber + 1;
      const style = parseInt(cell.attrs.s ?? '0', 10) || 0;
      const value = valueOf(cell.body, cell.attrs.t, context, style);
      if (
        rows.length &&
        (rowNumber < rows[rows.length - 1] ||
          (rowNumber === rows[rows.length - 1] && colNumber <= cols[cols.length - 1]))
      ) {
        ordered = false;
      }
      rows.push(rowNumber);
      cols.push(colNumber);
      styleIds.push(style < context.styles.length ? style : 0);
      kinds.push(value.kind);
      textIds.push(intern(value.text));
      numbers.push(value.number);
      colors.push(value.color);
    }
  }

  const merges: number[] = [];
  for (const merge of elements(firstElement(xml, 'mergeCells')?.body ?? '', 'mergeCell')) {
    const [from, to] = (merge.attrs.ref ?? '').split(':').map(parseCellRef);
    if (from && to) {
      merges.push(from.row, from.col, to.row, to.col);
    }
  }

  let lastRow = -1;
  let lastCol = -1;
  for (let i = 0; i < rows.length; i++) {
    lastRow = Math.max(lastRow, rows[i]);
    lastCol = Math.max(lastCol, cols[i]);
  }
  for (let i = 0; i < merges.length; i += 4) {
    lastRow = Math.max(lastRow, merges[i + 2]);
    lastCol = Math.max(lastCol, merges[i + 3]);
  }
  const frozenRows = frozen ? parseInt(pane?.attrs.ySplit ?? '0', 10) || 0 : 0;
  const frozenCols = frozen ? parseInt(pane?.attrs.xSplit ?? '0', 10) || 0 : 0;
  const rowCount = Math.max(lastRow + 1, frozenRows, MIN_ROWS);
  const colCount = Math.max(lastCol + 1, frozenCols, MIN_COLS);

  // Sort cells by row, then column, if the file listed them out of order.
  let order = rows.map((_, i) => i);
  if (!ordered) {
    order = order.sort((a, b) => rows[a] - rows[b] || cols[a] - cols[b]);
  }
  const count = order.length;
  const rowStarts = new Uint32Array(rowCount + 1);
  const cellCols = new Uint16Array(count);
  const cellStyles = new Uint32Array(count);
  const cellKinds = new Uint8Array(count);
  const cellTexts = new Uint32Array(count);
  const cellNumbers = new Float64Array(count);
  const cellFormatColors = new Uint8Array(count);
  order.forEach((source, target) => {
    rowStarts[rows[source] + 1]++;
    cellCols[target] = cols[source];
    cellStyles[target] = styleIds[source];
    cellKinds[target] = kinds[source];
    cellTexts[target] = textIds[source];
    cellNumbers[target] = numbers[source];
    cellFormatColors[target] = colors[source];
  });
  for (let r = 0; r < rowCount; r++) {
    rowStarts[r + 1] += rowStarts[r];
  }

  const rowHeights = new Float32Array(rowCount).fill(defaultRowHeight);
  for (const [row, height] of rowHeightOverrides) {
    if (row < rowCount) rowHeights[row] = height;
  }
  const colWidths = new Float32Array(colCount).fill(defaultColWidth);
  for (const col of elements(firstElement(xml, 'cols')?.body ?? '', 'col')) {
    const min = parseInt(col.attrs.min ?? '1', 10) - 1;
    const max = Math.min(parseInt(col.attrs.max ?? `${min + 1}`, 10) - 1, colCount - 1);
    const hidden = col.attrs.hidden === '1' || col.attrs.hidden === 'true';
    const width = col.attrs.width ? columnPixels(parseFloat(col.attrs.width)) : defaultColWidth;
    for (let c = min; c <= max; c++) {
      colWidths[c] = hidden ? 0 : width;
    }
  }

  return {
    rowCount,
    colCount,
    rowStarts,
    cellCols,
    cellStyles,
    cellKinds,
    cellTexts,
    cellNumbers,
    cellFormatColors,
    texts,
    colWidths,
    rowHeights,
    defaultColWidth,
    defaultRowHeight,
    merges: Uint32Array.from(merges),
    frozenRows,
    frozenCols,
    showGridLines: view?.attrs.showGridLines !== '0' && view?.attrs.showGridLines !== 'false',
  };
}

/** Excel's conversion from stored column width (characters) to pixels. */
function columnPixels(width: number): number {
  return Math.trunc(((256 * width + Math.trunc(128 / MAX_DIGIT_WIDTH)) / 256) * MAX_DIGIT_WIDTH);
}

interface CellValue {
  kind: number;
  text: string;
  number: number;
  color: number;
}

const EMPTY: CellValue = { kind: CellKind.Empty, text: '', number: NaN, color: 0 };

function valueOf(
  body: string,
  type: string | undefined,
  context: SheetContext,
  style: number,
): CellValue {
  const code = context.formats[style] ?? 'General';
  if (type === 'inlineStr') {
    const inline = firstElement(body, 'is');
    const text = inline ? textRuns(inline.body) : '';
    return { kind: CellKind.Text, text: formatText(text, code), number: NaN, color: 0 };
  }
  const raw = /<(?:[\w.-]+:)?v>([\s\S]*?)<\/(?:[\w.-]+:)?v>/.exec(body)?.[1];
  if (raw === undefined) {
    return EMPTY;
  }
  switch (type) {
    case 's': {
      const text = context.sharedStrings[parseInt(raw, 10)] ?? '';
      return { kind: CellKind.Text, text: formatText(text, code), number: NaN, color: 0 };
    }
    case 'str':
      return {
        kind: CellKind.Text,
        text: formatText(decodeEntities(raw), code),
        number: NaN,
        color: 0,
      };
    case 'b':
      return {
        kind: CellKind.Boolean,
        text: raw === '1' ? 'TRUE' : 'FALSE',
        number: NaN,
        color: 0,
      };
    case 'e':
      return { kind: CellKind.Error, text: decodeEntities(raw), number: NaN, color: 0 };
    case 'd': {
      const time = Date.parse(raw);
      if (Number.isNaN(time)) {
        return { kind: CellKind.Text, text: raw, number: NaN, color: 0 };
      }
      const serial = (time - Date.UTC(1899, 11, 30)) / 86_400_000;
      return numberValue(serial, code === 'General' ? 'yyyy-mm-dd' : code, context.date1904);
    }
    default: {
      const value = parseFloat(raw);
      return Number.isNaN(value)
        ? { kind: CellKind.Text, text: decodeEntities(raw), number: NaN, color: 0 }
        : numberValue(value, code, context.date1904);
    }
  }
}

function numberValue(value: number, code: string, date1904: boolean): CellValue {
  const formatted = formatNumber(value, code, date1904);
  return { kind: CellKind.Number, text: formatted.text, number: value, color: formatted.color };
}

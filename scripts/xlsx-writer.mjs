// A tiny SpreadsheetML writer for test fixtures. Only what the fixtures need: shared strings,
// numbers, booleans, errors, styles given as XML, merges, frozen panes, column widths.
import JSZip from 'jszip';

/**
 * @typedef {{ ref: string, value: string | number | boolean | null, style?: number, error?: boolean, formula?: string }} Cell
 * @typedef {{ name: string, hidden?: boolean, tabColor?: string, frozen?: { rows: number, cols: number },
 *   showGridLines?: boolean, cols?: { min: number, max: number, width: number, hidden?: boolean }[],
 *   rowHeights?: Record<number, number>, hiddenRows?: number[], merges?: string[], cells: Cell[] }} Sheet
 * @typedef {{ numFmts?: string[], fonts: string[], fills: string[], borders: string[], cellXfs: string[] }} Styles
 */

const escape = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function rowOf(ref) {
  return parseInt(/\d+/.exec(ref)[0], 10);
}

function colOf(ref) {
  let col = 0;
  for (const char of /^[A-Z]+/.exec(ref)[0]) col = col * 26 + char.charCodeAt(0) - 64;
  return col;
}

/**
 * @param {{ sheets: Sheet[], styles: Styles, activeSheet?: number }} workbook
 * @returns {Promise<Buffer>}
 */
export async function writeXlsx({ sheets, styles, activeSheet = 0 }) {
  const zip = new JSZip();
  const strings = [];
  const stringIndex = new Map();
  const shared = (text) => {
    if (!stringIndex.has(text)) {
      stringIndex.set(text, strings.length);
      strings.push(text);
    }
    return stringIndex.get(text);
  };

  sheets.forEach((sheet, i) => {
    const rows = new Map();
    for (const cell of sheet.cells) {
      const r = rowOf(cell.ref);
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r).push(cell);
    }
    for (const r of sheet.hiddenRows ?? []) if (!rows.has(r)) rows.set(r, []);
    for (const r of Object.keys(sheet.rowHeights ?? {})) if (!rows.has(+r)) rows.set(+r, []);

    const rowXml = [...rows.keys()]
      .sort((a, b) => a - b)
      .map((r) => {
        const cells = rows
          .get(r)
          .sort((a, b) => colOf(a.ref) - colOf(b.ref))
          .map((cell) => {
            const s = cell.style ? ` s="${cell.style}"` : '';
            const f = cell.formula ? `<f>${escape(cell.formula)}</f>` : '';
            if (cell.value === null || cell.value === undefined) return `<c r="${cell.ref}"${s}/>`;
            if (cell.error)
              return `<c r="${cell.ref}"${s} t="e">${f}<v>${escape(cell.value)}</v></c>`;
            if (typeof cell.value === 'boolean')
              return `<c r="${cell.ref}"${s} t="b">${f}<v>${cell.value ? 1 : 0}</v></c>`;
            if (typeof cell.value === 'number')
              return `<c r="${cell.ref}"${s}>${f}<v>${cell.value}</v></c>`;
            return `<c r="${cell.ref}"${s} t="s"><v>${shared(cell.value)}</v></c>`;
          })
          .join('');
        const height = sheet.rowHeights?.[r];
        const attrs = [
          `r="${r}"`,
          height ? `ht="${height}" customHeight="1"` : '',
          sheet.hiddenRows?.includes(r) ? 'hidden="1"' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<row ${attrs}>${cells}</row>`;
      })
      .join('');

    const pane = sheet.frozen
      ? `<pane xSplit="${sheet.frozen.cols}" ySplit="${sheet.frozen.rows}" topLeftCell="${columnLetters(sheet.frozen.cols + 1)}${sheet.frozen.rows + 1}" activePane="bottomRight" state="frozen"/>`
      : '';
    const gridLines = sheet.showGridLines === false ? ' showGridLines="0"' : '';
    const cols = sheet.cols?.length
      ? `<cols>${sheet.cols
          .map(
            (col) =>
              `<col min="${col.min}" max="${col.max}" width="${col.width}" customWidth="1"${col.hidden ? ' hidden="1"' : ''}/>`,
          )
          .join('')}</cols>`
      : '';
    const merges = sheet.merges?.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
      : '';
    const tab = sheet.tabColor ? `<sheetPr><tabColor rgb="FF${sheet.tabColor}"/></sheetPr>` : '';
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">${tab}` +
        `<sheetViews><sheetView workbookViewId="0"${gridLines}${i === activeSheet ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>` +
        `<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowXml}</sheetData>${merges}</worksheet>`,
    );
  });

  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${NS}" count="${strings.length}" uniqueCount="${strings.length}">` +
      strings.map((text) => `<si><t xml:space="preserve">${escape(text)}</t></si>`).join('') +
      '</sst>',
  );

  const list = (name, items) => `<${name} count="${items.length}">${items.join('')}</${name}>`;
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${NS}">` +
      (styles.numFmts?.length ? list('numFmts', styles.numFmts) : '') +
      list('fonts', styles.fonts) +
      list('fills', styles.fills) +
      list('borders', styles.borders) +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      list('cellXfs', styles.cellXfs) +
      '</styleSheet>',
  );

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS}" xmlns:r="${REL_NS}">` +
      `<bookViews><workbookView activeTab="${activeSheet}"/></bookViews><sheets>` +
      sheets
        .map(
          (sheet, i) =>
            `<sheet name="${escape(sheet.name)}" sheetId="${i + 1}"${sheet.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`,
        )
        .join('') +
      '</sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rIdS" Type="${REL}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rIdT" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` +
      '</Relationships>',
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '</Types>',
  );

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Column letters for a 1-based column number. */
export function columnLetters(col) {
  let name = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

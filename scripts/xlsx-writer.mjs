// A tiny SpreadsheetML writer for test fixtures. Only what the fixtures need: shared strings,
// numbers, booleans, errors, styles and conditional formats given as XML, merges, frozen
// panes, column widths, and drawings (PNG pictures, column charts, text boxes).
import JSZip from 'jszip';

/**
 * @typedef {{ ref: string, value: string | number | boolean | null, style?: number, error?: boolean, formula?: string, shared?: { si: number, ref?: string } }} Cell
 * @typedef {{ name: string, hidden?: boolean, tabColor?: string, frozen?: { rows: number, cols: number },
 *   showGridLines?: boolean, cols?: { min: number, max: number, width: number, hidden?: boolean, style?: number }[],
 *   rowHeights?: Record<number, number>, rowStyles?: Record<number, number>, hiddenRows?: number[],
 *   merges?: string[], cells: Cell[],
 *   conditionalFormats?: string[], drawings?: Drawing[] }} Sheet
 * @typedef {{ numFmts?: string[], fonts: string[], fills: string[], borders: string[], cellXfs: string[], dxfs?: string[] }} Styles
 * @typedef {{ col: number, row: number }} Point 0-based
 * @typedef {{ width: number, height: number }} Size pixels
 * @typedef {{ name: string, categories: string, values: string, labels: string[], numbers: number[] }} Series
 * @typedef {{ type: 'picture', from: Point, to?: Point, size?: Size, png: Buffer }
 *   | { type: 'chart', from: Point, to: Point, title?: string, axisTitle?: string, series: Series }
 *   | { type: 'text', from: Point, size: Size, text: string, fill?: string }} Drawing
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
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XDR_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const EMU_PER_PIXEL = 9525;

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
  const parts = { drawings: [], charts: 0, images: 0 };
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
    for (const r of Object.keys({ ...sheet.rowHeights, ...sheet.rowStyles }))
      if (!rows.has(+r)) rows.set(+r, []);

    const rowXml = [...rows.keys()]
      .sort((a, b) => a - b)
      .map((r) => {
        const cells = rows
          .get(r)
          .sort((a, b) => colOf(a.ref) - colOf(b.ref))
          .map((cell) => {
            const s = cell.style ? ` s="${cell.style}"` : '';
            // A shared formula is written once, on the first cell of its range, as Excel does.
            const f = cell.shared
              ? cell.shared.ref
                ? `<f t="shared" ref="${cell.shared.ref}" si="${cell.shared.si}">${escape(cell.formula)}</f>`
                : `<f t="shared" si="${cell.shared.si}"/>`
              : cell.formula
                ? `<f>${escape(cell.formula)}</f>`
                : '';
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
          sheet.rowStyles?.[r] ? `s="${sheet.rowStyles[r]}" customFormat="1"` : '',
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
              `<col min="${col.min}" max="${col.max}" width="${col.width}" customWidth="1"${col.hidden ? ' hidden="1"' : ''}${col.style ? ` style="${col.style}"` : ''}/>`,
          )
          .join('')}</cols>`
      : '';
    const merges = sheet.merges?.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
      : '';
    const tab = sheet.tabColor ? `<sheetPr><tabColor rgb="FF${sheet.tabColor}"/></sheetPr>` : '';
    const conditional = sheet.conditionalFormats?.join('') ?? '';
    const drawing = sheet.drawings?.length ? '<drawing r:id="rId1"/>' : '';
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">${tab}` +
        `<sheetViews><sheetView workbookViewId="0"${gridLines}${i === activeSheet ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>` +
        `<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowXml}</sheetData>${merges}${conditional}${drawing}</worksheet>`,
    );
    if (drawing) {
      zip.file(
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        relationships([['rId1', 'drawing', `../drawings/drawing${i + 1}.xml`]]),
      );
      writeDrawing(zip, `drawing${i + 1}.xml`, sheet.drawings, parts);
      parts.drawings.push(i + 1);
    }
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
      (styles.dxfs?.length ? list('dxfs', styles.dxfs) : '') +
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
    relationships([
      ...sheets.map((_, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`]),
      ['rIdS', 'styles', 'styles.xml'],
      ['rIdT', 'sharedStrings', 'sharedStrings.xml'],
    ]),
  );
  zip.file('_rels/.rels', relationships([['rId1', 'officeDocument', 'xl/workbook.xml']]));

  const override = (part, type) =>
    `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`;
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      (parts.images ? '<Default Extension="png" ContentType="image/png"/>' : '') +
      override('/xl/workbook.xml', 'spreadsheetml.sheet.main+xml') +
      sheets
        .map((_, i) => override(`/xl/worksheets/sheet${i + 1}.xml`, 'spreadsheetml.worksheet+xml'))
        .join('') +
      override('/xl/styles.xml', 'spreadsheetml.styles+xml') +
      override('/xl/sharedStrings.xml', 'spreadsheetml.sharedStrings+xml') +
      parts.drawings.map((n) => override(`/xl/drawings/drawing${n}.xml`, 'drawing+xml')).join('') +
      Array.from({ length: parts.charts }, (_, i) =>
        override(`/xl/charts/chart${i + 1}.xml`, 'drawingml.chart+xml'),
      ).join('') +
      '</Types>',
  );

  // A fixed timestamp keeps regenerated fixtures byte-identical.
  const date = new Date(Date.UTC(2024, 0, 1));
  zip.forEach((_, file) => {
    file.date = date;
  });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** @param {string[][]} items [id, relationship type, target] */
function relationships(items) {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PACKAGE_REL_NS}">` +
    items
      .map(
        ([id, type, target]) =>
          `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`,
      )
      .join('') +
    '</Relationships>'
  );
}

const emu = (pixels) => Math.round(pixels * EMU_PER_PIXEL);

/** @param {string} name @param {Point} point */
const marker = (name, point) =>
  `<xdr:${name}><xdr:col>${point.col}</xdr:col><xdr:colOff>0</xdr:colOff>` +
  `<xdr:row>${point.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${name}>`;

/**
 * @param {JSZip} zip
 * @param {string} name
 * @param {Drawing[]} drawings
 * @param {{ charts: number, images: number }} parts numbering shared across sheets
 */
function writeDrawing(zip, name, drawings, parts) {
  const rels = [];
  const anchors = drawings.map((drawing, i) => {
    const id = i + 2;
    const rId = `rId${rels.length + 1}`;
    let body;
    if (drawing.type === 'picture') {
      parts.images++;
      zip.file(`xl/media/image${parts.images}.png`, drawing.png);
      rels.push([rId, 'image', `../media/image${parts.images}.png`]);
      body =
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Picture ${id}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>';
    } else if (drawing.type === 'chart') {
      parts.charts++;
      zip.file(`xl/charts/chart${parts.charts}.xml`, chartXml(drawing));
      rels.push([rId, 'chart', `../charts/chart${parts.charts}.xml`]);
      body =
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="Chart ${id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
        `<a:graphic><a:graphicData uri="${C_NS}"><c:chart r:id="${rId}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
    } else {
      const fill = drawing.fill
        ? `<a:solidFill>${colorXml(drawing.fill)}</a:solidFill>`
        : '<a:noFill/>';
      const paragraphs = drawing.text
        .split('\n')
        .map(
          (line) =>
            `<a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>${escape(line)}</a:t></a:r></a:p>`,
        )
        .join('');
      body =
        `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="TextBox ${id}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>` +
        `<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}` +
        '<a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></xdr:spPr>' +
        `<xdr:txBody><a:bodyPr wrap="square" anchor="t"/><a:lstStyle/>${paragraphs}</xdr:txBody></xdr:sp>`;
    }
    const placement = drawing.to
      ? marker('from', drawing.from) + marker('to', drawing.to)
      : marker('from', drawing.from) +
        `<xdr:ext cx="${emu(drawing.size.width)}" cy="${emu(drawing.size.height)}"/>`;
    const kind = drawing.to ? 'twoCellAnchor' : 'oneCellAnchor';
    return `<xdr:${kind}>${placement}${body}<xdr:clientData/></xdr:${kind}>`;
  });
  zip.file(
    `xl/drawings/${name}`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="${XDR_NS}" xmlns:a="${A_NS}" xmlns:r="${REL_NS}" xmlns:c="${C_NS}">` +
      anchors.join('') +
      '</xdr:wsDr>',
  );
  if (rels.length) zip.file(`xl/drawings/_rels/${name}.rels`, relationships(rels));
}

/** A hex color (`4472C4`) or a theme color name (`accent1`). */
function colorXml(color) {
  return /^[0-9A-F]{6}$/i.test(color)
    ? `<a:srgbClr val="${color}"/>`
    : `<a:schemeClr val="${color}"/>`;
}

const richText = (text) =>
  `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escape(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/>`;

/** A clustered column chart with one series and cached values, so Excel shows it as is. */
function chartXml({ title, axisTitle, series }) {
  const points = (values) =>
    `<c:ptCount val="${values.length}"/>` +
    values.map((value, i) => `<c:pt idx="${i}"><c:v>${escape(value)}</c:v></c:pt>`).join('');
  const axis = (tag, id, cross, position, extra = '') =>
    `<c:${tag}><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${position}"/>${extra}<c:crossAx val="${cross}"/></c:${tag}>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${A_NS}" xmlns:r="${REL_NS}"><c:chart>` +
    (title
      ? `<c:title>${richText(title)}</c:title><c:autoTitleDeleted val="0"/>`
      : '<c:autoTitleDeleted val="1"/>') +
    '<c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
    `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${escape(series.name)}</c:v></c:tx>` +
    `<c:cat><c:strRef><c:f>${escape(series.categories)}</c:f><c:strCache>${points(series.labels)}</c:strCache></c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${escape(series.values)}</c:f><c:numCache><c:formatCode>General</c:formatCode>${points(series.numbers)}</c:numCache></c:numRef></c:val>` +
    '</c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart>' +
    axis('catAx', 1, 2, 'b') +
    axis('valAx', 2, 1, 'l', axisTitle ? `<c:title>${richText(axisTitle)}</c:title>` : '') +
    '</c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>'
  );
}

/** Column letters for a 1-based column number. */
export function columnLetters(col) {
  let name = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

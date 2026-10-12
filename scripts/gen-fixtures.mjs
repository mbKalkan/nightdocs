// Generates the sample documents in test/fixtures. Run with `npm run fixtures`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { writeXlsx } from './xlsx-writer.mjs';

const OUT = 'test/fixtures';
/** `--large` only writes the big generated workbook used for performance tests. */
const LARGE_ONLY = process.argv.includes('--large');
mkdirSync(OUT, { recursive: true });

// --- Tiny PNG encoder, enough for a generated chart image -----------------------------------

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw.set(pixel(x, y), row + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chartImage() {
  const width = 480;
  const height = 240;
  const bars = [0.45, 0.7, 0.55, 0.9, 0.65, 0.8];
  const colors = [
    [68, 114, 196],
    [237, 125, 49],
    [112, 173, 71],
    [255, 192, 0],
    [91, 155, 213],
    [165, 165, 165],
  ];
  return png(width, height, (x, y) => {
    const slot = Math.floor((x - 30) / 72);
    const inBar = x >= 30 && slot < bars.length && (x - 30) % 72 < 48;
    if (inBar && y >= height - 20 - bars[slot] * (height - 40) && y < height - 20) {
      return [...colors[slot], 255];
    }
    if (y === height - 20 && x >= 20 && x < width - 20) {
      return [89, 89, 89, 255];
    }
    return [255, 255, 255, 255];
  });
}

// --- Deterministic filler text --------------------------------------------------------------

const WORDS = (
  'the quarterly report outlines revenue growth across regions while operating costs remained ' +
  'stable and the team expanded customer support coverage to new markets with improved response ' +
  'times detailed metrics follow in the appendix along with risks assumptions and next steps'
).split(' ');

function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function sentence(random, length) {
  const words = Array.from({ length }, () => WORDS[Math.floor(random() * WORDS.length)]);
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

function paragraphText(random) {
  return Array.from({ length: 3 + Math.floor(random() * 3) }, () =>
    sentence(random, 8 + Math.floor(random() * 10)),
  ).join(' ');
}

// --- Documents ------------------------------------------------------------------------------

const pageHeader = (text) =>
  new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text, color: '7F7F7F', size: 18 })],
      }),
    ],
  });

const pageFooter = () =>
  new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
            size: 18,
          }),
        ],
      }),
    ],
  });

function headerCell(text) {
  return new TableCell({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: '1F4E79' },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF' })] })],
  });
}

function cell(text, fill) {
  return new TableCell({
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    children: [new Paragraph(text)],
  });
}

function sampleDocument() {
  const random = makeRandom(7);
  const rows = [
    ['North', '1,240', '1,385', '+11.7%'],
    ['South', '980', '1,012', '+3.3%'],
    ['East', '1,105', '1,060', '-4.1%'],
    ['West', '1,430', '1,598', '+11.7%'],
  ];

  return new Document({
    creator: 'Nightdocs',
    title: 'Quarterly Report',
    description: 'Sample document for Nightdocs',
    footnotes: {
      1: { children: [new Paragraph('Figures are in thousands of US dollars.')] },
    },
    numbering: {
      config: [
        {
          reference: 'steps',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
          ],
        },
      ],
    },
    sections: [
      {
        headers: { default: pageHeader('Quarterly Report — Q3') },
        footers: { default: pageFooter() },
        children: [
          new Paragraph({ text: 'Quarterly Report', heading: HeadingLevel.TITLE }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Prepared for the leadership team. ', italics: true }),
              new TextRun({ text: 'Confidential', bold: true, color: 'C00000' }),
            ],
          }),
          new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun('Revenue grew in three of four regions'),
              new FootnoteReferenceRun(1),
              new TextRun('. Highlights include '),
              new TextRun({ text: 'record retention', bold: true }),
              new TextRun(', '),
              new TextRun({ text: 'faster onboarding', underline: {} }),
              new TextRun(' and '),
              new TextRun({ text: 'lower support backlog', highlight: 'yellow' }),
              new TextRun('. See the '),
              new ExternalHyperlink({
                link: 'https://example.com/report',
                children: [new TextRun({ text: 'full report online', style: 'Hyperlink' })],
              }),
              new TextRun('.'),
            ],
          }),
          new Paragraph(paragraphText(random)),
          new Paragraph({ text: 'Key points', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: 'Retention reached an all-time high.', bullet: { level: 0 } }),
          new Paragraph({ text: 'Onboarding time dropped by two days.', bullet: { level: 0 } }),
          new Paragraph({
            text: 'Self-service answers most common questions.',
            bullet: { level: 1 },
          }),
          new Paragraph({ text: 'Regional results', heading: HeadingLevel.HEADING_1 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: ['Region', 'Q2', 'Q3', 'Change'].map(headerCell),
              }),
              ...rows.map(
                (values, index) =>
                  new TableRow({
                    children: values.map((value) => cell(value, index % 2 ? 'DEEAF6' : undefined)),
                  }),
              ),
            ],
          }),
          new Paragraph(''),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: 'png',
                data: chartImage(),
                transformation: { width: 480, height: 240 },
                altText: { name: 'chart', title: 'Revenue by region', description: 'Bar chart' },
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Figure 1. Revenue by region', italics: true, size: 18 }),
            ],
          }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ text: 'Next steps', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            text: 'Expand self-service content.',
            numbering: { reference: 'steps', level: 0 },
          }),
          new Paragraph({
            text: 'Hire two support engineers.',
            numbering: { reference: 'steps', level: 0 },
          }),
          new Paragraph({
            text: 'Review pricing in the East region.',
            numbering: { reference: 'steps', level: 0 },
          }),
          ...Array.from({ length: 6 }, () => new Paragraph(paragraphText(random))),
          new Paragraph({
            children: [
              new TextRun({ text: 'Colored text: ', bold: true }),
              new TextRun({ text: 'blue ', color: '2E74B5' }),
              new TextRun({ text: 'green ', color: '548235' }),
              new TextRun({ text: 'orange ', color: 'C55A11' }),
              new TextRun({ text: 'gray', color: '7F7F7F' }),
            ],
          }),
        ],
      },
    ],
  });
}

function longDocument() {
  const random = makeRandom(42);
  const children = [];
  for (let chapter = 1; chapter <= 12; chapter++) {
    children.push(new Paragraph({ text: `Chapter ${chapter}`, heading: HeadingLevel.HEADING_1 }));
    for (let i = 0; i < 14; i++) {
      children.push(new Paragraph(paragraphText(random)));
    }
  }
  return new Document({
    creator: 'Nightdocs',
    title: 'Long Document',
    sections: [
      {
        headers: { default: pageHeader('Long Document') },
        footers: { default: pageFooter() },
        children,
      },
    ],
  });
}

async function write(name, document) {
  writeFileSync(`${OUT}/${name}`, await Packer.toBuffer(document));
  console.log(`wrote ${OUT}/${name}`);
}

if (!LARGE_ONLY) {
  await write('sample.docx', sampleDocument());
  await write('long.docx', longDocument());
}

if (!LARGE_ONLY) {
  // Not a ZIP archive at all.
  writeFileSync(`${OUT}/damaged.docx`, 'This is not a Word document.\n');
  console.log(`wrote ${OUT}/damaged.docx`);

  // Compound File Binary header, as used by password-protected OOXML and legacy .doc files.
  const cfb = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(cfb);
  writeFileSync(`${OUT}/protected.docx`, cfb);
  console.log(`wrote ${OUT}/protected.docx`);
}

// --- Workbooks -------------------------------------------------------------------------------

const BASE_STYLES = {
  numFmts: [
    '<numFmt numFmtId="164" formatCode="0.0%;[Red]-0.0%"/>',
    '<numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/>',
    '<numFmt numFmtId="166" formatCode="yyyy-mm-dd"/>',
  ],
  fonts: [
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/></font>',
    '<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    '<font><i/><sz val="11"/><color rgb="FF7F7F7F"/><name val="Calibri"/></font>',
    '<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font>',
    '<font><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/></font>',
  ],
  fills: [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.79998168889431442"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill>',
  ],
  borders: [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left/><right/><top/><bottom style="medium"><color auto="1"/></bottom><diagonal/></border>',
    '<border><left/><right/><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom><diagonal/></border>',
    '<border><left style="thin"><color rgb="FFA6A6A6"/></left><right style="thin"><color rgb="FFA6A6A6"/></right><top style="thin"><color rgb="FFA6A6A6"/></top><bottom style="thin"><color rgb="FFA6A6A6"/></bottom><diagonal/></border>',
  ],
  cellXfs: [
    /* 0 default */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    /* 1 title */ '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    /* 2 header */ '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0"/>',
    /* 3 header, right */ '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>',
    /* 4 thousands */ '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    /* 5 percent, red negatives */ '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    /* 6 currency */ '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    /* 7 short date (locale) */ '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    /* 8 wrapped note */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>',
    /* 9 total label */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0"/>',
    /* 10 total number */ '<xf numFmtId="3" fontId="1" fillId="0" borderId="2" xfId="0"/>',
    /* 11 highlight */ '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0"/>',
    /* 12 red text */ '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0"/>',
    /* 13 boxed */ '<xf numFmtId="0" fontId="0" fillId="5" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>',
    /* 14 iso date */ '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    /* 15 link */ '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0"/>',
  ],
};

function budgetSheet() {
  const regions = [
    ['North', 1240, 1385, 'Strong retail season', 45580],
    ['South', 980, 1012, 'New office opened in the second half of the quarter after delays', 45581],
    ['East', 1105, 1060, 'Price pressure', 45582],
    ['West', 1430, 1598, '', 45583],
    ['Central', 760, 802, 'Stable', 45584],
    ['Online', 2210, 2650, 'Campaign', 45585],
  ];
  const cells = [
    { ref: 'A1', value: 'Q3 Budget Overview', style: 1 },
    { ref: 'A2', value: 'Region', style: 2 },
    { ref: 'B2', value: 'Q2', style: 3 },
    { ref: 'C2', value: 'Q3', style: 3 },
    { ref: 'D2', value: 'Change', style: 3 },
    { ref: 'E2', value: 'Notes', style: 2 },
    { ref: 'F2', value: 'Updated', style: 3 },
  ];
  regions.forEach(([name, q2, q3, note, date], i) => {
    const r = i + 3;
    cells.push(
      { ref: `A${r}`, value: name },
      { ref: `B${r}`, value: q2, style: 4 },
      { ref: `C${r}`, value: q3, style: 4 },
      {
        ref: `D${r}`,
        value: Math.round(((q3 - q2) / q2) * 1000) / 1000,
        style: 5,
        formula: `C${r}/B${r}-1`,
      },
      { ref: `F${r}`, value: date, style: 7 },
    );
    if (note) cells.push({ ref: `E${r}`, value: note, style: r === 4 ? 8 : 0 });
  });
  const q2 = regions.reduce((sum, row) => sum + row[1], 0);
  const q3 = regions.reduce((sum, row) => sum + row[2], 0);
  cells.push(
    { ref: 'A9', value: 'Total', style: 9 },
    { ref: 'B9', value: q2, style: 10, formula: 'SUM(B3:B8)' },
    { ref: 'C9', value: q3, style: 10, formula: 'SUM(C3:C8)' },
    { ref: 'D9', value: Math.round(((q3 - q2) / q2) * 1000) / 1000, style: 5 },
    { ref: 'E9', value: null, style: 9 },
    { ref: 'F9', value: null, style: 9 },
    { ref: 'A10', value: 'Note:', style: 0 },
    {
      ref: 'B10',
      value: 'Figures are in thousands of US dollars and exclude one-off items.',
      style: 0,
    },
    { ref: 'A11', value: 'Approved' },
    { ref: 'B11', value: true },
    { ref: 'C11', value: 'Ratio' },
    { ref: 'D11', value: '#DIV/0!', error: true },
    { ref: 'A12', value: 'Highlighted', style: 11 },
    { ref: 'B12', value: 'Red text', style: 12 },
    { ref: 'C12', value: 'Boxed', style: 13 },
    { ref: 'D12', value: 'Link style', style: 15 },
    { ref: 'A13', value: 1234.5, style: 6 },
    { ref: 'B13', value: 45600, style: 14 },
    { ref: 'B14', value: 12345678901, style: 4 },
  );
  return {
    name: 'Budget',
    tabColor: '70AD47',
    frozen: { rows: 2, cols: 1 },
    cols: [
      { min: 1, max: 1, width: 22 },
      { min: 2, max: 3, width: 12 },
      { min: 4, max: 4, width: 10 },
      { min: 5, max: 5, width: 30 },
      { min: 6, max: 6, width: 12 },
    ],
    rowHeights: { 1: 28, 4: 45 },
    merges: ['A1:F1'],
    cells,
  };
}

function dataSheet(rows) {
  const random = makeRandom(11);
  const headers = ['ID', 'Region', 'Product', 'Units', 'Price', 'Revenue', 'Margin', 'Date'];
  const regions = ['North', 'South', 'East', 'West'];
  const products = ['Basic', 'Plus', 'Pro', 'Enterprise'];
  const cells = headers.map((value, i) => ({
    ref: `${String.fromCharCode(65 + i)}1`,
    value,
    style: 2,
  }));
  for (let r = 2; r <= rows + 1; r++) {
    const units = 1 + Math.floor(random() * 500);
    const price = Math.round((10 + random() * 90) * 100) / 100;
    cells.push(
      { ref: `A${r}`, value: r - 1 },
      { ref: `B${r}`, value: regions[r % 4] },
      { ref: `C${r}`, value: products[Math.floor(random() * 4)] },
      { ref: `D${r}`, value: units, style: 4 },
      { ref: `E${r}`, value: price, style: 6 },
      { ref: `F${r}`, value: Math.round(units * price * 100) / 100, style: 6 },
      { ref: `G${r}`, value: Math.round((random() * 0.6 - 0.1) * 1000) / 1000, style: 5 },
      { ref: `H${r}`, value: 45200 + (r % 365), style: 14 },
    );
  }
  return {
    name: 'Data',
    frozen: { rows: 1, cols: 0 },
    cols: [
      { min: 1, max: 1, width: 8 },
      { min: 2, max: 3, width: 12 },
      { min: 4, max: 7, width: 12 },
      { min: 8, max: 8, width: 12 },
    ],
    cells,
  };
}

function chartsSheet() {
  const series = {
    name: 'Q3',
    categories: 'Budget!$A$3:$A$8',
    values: 'Budget!$C$3:$C$8',
    labels: ['North', 'South', 'East', 'West', 'Central', 'Online'],
    numbers: [1385, 1012, 1060, 1598, 802, 2650],
  };
  // A small badge far past the data, so the sheet must grow to show it.
  const badge = png(96, 48, (x, y) =>
    y >= 20 && y < 28 ? [255, 255, 255, 255] : [237, 125, 49, 255],
  );
  return {
    name: 'Charts',
    frozen: { rows: 1, cols: 0 },
    cells: [{ ref: 'A1', value: 'Drawings', style: 1 }],
    merges: ['A1:H1'],
    drawings: [
      {
        type: 'chart',
        from: { col: 1, row: 2 },
        to: { col: 8, row: 17 },
        title: 'Q3 revenue by region',
        series,
      },
      // Crosses the frozen row, so each pane draws its part.
      { type: 'picture', from: { col: 9, row: 0 }, to: { col: 14, row: 11 }, png: chartImage() },
      {
        type: 'text',
        from: { col: 9, row: 13 },
        size: { width: 320, height: 64 },
        text: 'Pictures, charts and text boxes\nare drawn over the grid.',
        fill: 'lt1',
      },
      {
        type: 'chart',
        from: { col: 1, row: 19 },
        to: { col: 8, row: 32 },
        axisTitle: 'Thousands',
        series,
      },
      { type: 'picture', from: { col: 30, row: 70 }, size: { width: 96, height: 48 }, png: badge },
    ],
  };
}

function sampleWorkbook(dataRows) {
  return {
    styles: BASE_STYLES,
    sheets: [
      budgetSheet(),
      dataSheet(dataRows),
      {
        name: 'Hidden',
        hidden: true,
        cells: [{ ref: 'A1', value: 'You should not see this tab' }],
      },
      {
        name: 'No Grid',
        showGridLines: false,
        cells: [
          { ref: 'B2', value: 'A sheet without grid lines', style: 1 },
          { ref: 'B4', value: 'Contact', style: 2 },
          { ref: 'C4', value: 'support@example.com', style: 15 },
        ],
        merges: ['B2:D2'],
        cols: [{ min: 2, max: 4, width: 20 }],
      },
      chartsSheet(),
    ],
  };
}

if (!LARGE_ONLY) {
  writeFileSync(`${OUT}/sample.xlsx`, await writeXlsx(sampleWorkbook(2000)));
  console.log(`wrote ${OUT}/sample.xlsx`);
}

// 100k rows for performance checks; large, so it isn't committed.
mkdirSync(`${OUT}/generated`, { recursive: true });
writeFileSync(`${OUT}/generated/large.xlsx`, await writeXlsx(sampleWorkbook(100_000)));
console.log(`wrote ${OUT}/generated/large.xlsx`);

if (!LARGE_ONLY) {
  const cfbWorkbook = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(cfbWorkbook);
  writeFileSync(`${OUT}/protected.xlsx`, cfbWorkbook);
  console.log(`wrote ${OUT}/protected.xlsx`);
}

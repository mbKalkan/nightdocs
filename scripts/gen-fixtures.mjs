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

const OUT = 'test/fixtures';
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
    creator: 'Office Viewer',
    title: 'Quarterly Report',
    description: 'Sample document for Office Viewer',
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
    creator: 'Office Viewer',
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

await write('sample.docx', sampleDocument());
await write('long.docx', longDocument());

// Not a ZIP archive at all.
writeFileSync(`${OUT}/damaged.docx`, 'This is not a Word document.\n');
console.log(`wrote ${OUT}/damaged.docx`);

// Compound File Binary header, as used by password-protected OOXML and legacy .doc files.
const cfb = Buffer.alloc(512);
Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(cfb);
writeFileSync(`${OUT}/protected.docx`, cfb);
console.log(`wrote ${OUT}/protected.docx`);

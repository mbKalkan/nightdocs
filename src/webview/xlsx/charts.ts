// Draws Excel charts with the PowerPoint renderer: both store charts as the same DrawingML
// chart part, so each chart is drawn as the only thing on a one-slide presentation made up
// around it. Loaded only for sheets that have charts.
import { buildPresentation, renderSlide, type PptxFiles } from '@aiden0z/pptx-renderer';
import type { DarkPalette } from '../../shared/color';
import { adaptDocumentColors } from '../darkColors';
import { settleChart, type Chart } from '../pptx/chartColors';
import type { ChartPart } from './model';

const EMU_PER_PIXEL = 9525;
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/**
 * Draws a chart into `box`, at the box's size in pixels. The box must stay in the document:
 * the chart starts once it has a size and stops when it is taken out. `theme` is the
 * workbook's theme part, which chart colors like "accent 1" refer to. With a palette, text,
 * gridlines and the chart area follow the dark theme while the data keeps its colors, as in
 * presentations.
 */
export async function drawChart(
  part: ChartPart,
  theme: string | undefined,
  box: HTMLElement,
  palette: DarkPalette | undefined,
): Promise<void> {
  const width = Math.max(1, Math.round(box.offsetWidth));
  const height = Math.max(1, Math.round(box.offsetHeight));
  const presentation = buildPresentation(chartPackage(part, theme, width, height));
  const charts = new Set<Chart>();
  const handle = renderSlide(presentation, presentation.slides[0], {
    chartInstances: charts,
    pdfjs: false,
  });
  box.append(handle.element);
  await handle.ready;
  // The chart area is the slide background, under the box adapted like a page.
  if (palette) adaptDocumentColors([box], palette);
  for (const chart of charts) settleChart(chart, palette);
}

/** The parts of a presentation whose only slide is the chart, filling it. */
function chartPackage(
  part: ChartPart,
  theme: string | undefined,
  width: number,
  height: number,
): PptxFiles {
  const cx = width * EMU_PER_PIXEL;
  const cy = height * EMU_PER_PIXEL;
  const rels = (items: [string, string, string][]) =>
    `<Relationships xmlns="${PACKAGE_REL}">${items
      .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
      .join('')}</Relationships>`;
  const chartRels: [string, string, string][] = [];
  if (part.style) chartRels.push(['rId1', `${MS_REL}/chartStyle`, 'style1.xml']);
  if (part.colors) chartRels.push(['rId2', `${MS_REL}/chartColorStyle`, 'colors1.xml']);
  const tree = (content = '') =>
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${content}</p:spTree></p:cSld>`;
  const frame =
    '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
    `<p:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>`;
  const ns = `xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"`;
  return {
    contentTypes: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    presentation:
      `<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      `<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/>` +
      `<p:notesSz cx="${cy}" cy="${cx}"/></p:presentation>`,
    presentationRels: rels([
      ['rId1', `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml'],
      ['rId2', `${REL}/slide`, 'slides/slide1.xml'],
      ['rId3', `${REL}/theme`, 'theme/theme1.xml'],
    ]),
    slides: new Map([['ppt/slides/slide1.xml', `<p:sld ${ns}>${tree(frame)}</p:sld>`]]),
    slideRels: new Map([
      [
        'ppt/slides/_rels/slide1.xml.rels',
        rels([
          ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
          ['rId2', `${REL}/chart`, '../charts/chart1.xml'],
        ]),
      ],
    ]),
    slideLayouts: new Map([
      ['ppt/slideLayouts/slideLayout1.xml', `<p:sldLayout ${ns}>${tree()}</p:sldLayout>`],
    ]),
    slideLayoutRels: new Map([
      [
        'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
        rels([['rId1', `${REL}/slideMaster`, '../slideMasters/slideMaster1.xml']]),
      ],
    ]),
    slideMasters: new Map([
      [
        'ppt/slideMasters/slideMaster1.xml',
        `<p:sldMaster ${ns}>${tree()}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
          '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
      ],
    ]),
    slideMasterRels: new Map([
      [
        'ppt/slideMasters/_rels/slideMaster1.xml.rels',
        rels([
          ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
          ['rId2', `${REL}/theme`, '../theme/theme1.xml'],
        ]),
      ],
    ]),
    themes: new Map([['ppt/theme/theme1.xml', theme ?? OFFICE_THEME]]),
    media: new Map(),
    charts: new Map([['ppt/charts/chart1.xml', part.xml]]),
    chartRels: new Map([['ppt/charts/_rels/chart1.xml.rels', rels(chartRels)]]),
    chartStyles: new Map(part.style ? [['ppt/charts/style1.xml', part.style]] : []),
    chartColors: new Map(part.colors ? [['ppt/charts/colors1.xml', part.colors]] : []),
    diagramDrawings: new Map(),
  };
}

const MS_REL = 'http://schemas.microsoft.com/office/2011/relationships';

/** Office's default theme, for workbooks saved without one. */
const OFFICE_THEME =
  `<a:theme xmlns:a="${A}" name="Office Theme"><a:themeElements><a:clrScheme name="Office">` +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>' +
  '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
  '</a:fmtScheme></a:themeElements></a:theme>';

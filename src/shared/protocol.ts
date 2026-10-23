// Messages exchanged between the extension host and the webview.

export type DocumentFormat = 'docx' | 'xlsx' | 'pptx' | 'md';

/** `dark` adapts document colors to dark themes; `original` shows them as authored. */
export type ColorMode = 'dark' | 'original';

/** UI strings localized by the extension host and handed to the webview. */
export interface ViewerStrings {
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  showOriginalColors: string;
  showDarkColors: string;
  openInOffice: string;
  openInOfficeTooltip: string;
  loading: string;
  errorTitle: string;
  errorDamaged: string;
  errorProtectedOrLegacy: string;
  errorRender: string;
  errorRead: string;
  errorEmpty: string;
  /** Status bar templates for spreadsheet selections; `{0}` is the value. */
  statusCount: string;
  statusSum: string;
  statusAverage: string;
  /** Names the selected cell's formula for screen readers. */
  formula: string;
  followLink: string;
  /** `{0}` is the key to hold: Ctrl, or Cmd on macOS. */
  followLinkHint: string;
  find: string;
  findNoResults: string;
  /** `{0} of {1}` */
  findCount: string;
  findPrevious: string;
  findNext: string;
  findClose: string;
  chart: string;
  chartHint: string;
  /** Accessible name of the sheet tab list. */
  sheets: string;
  /** Buttons shown when the sheet tabs don't all fit. */
  allSheets: string;
  scrollSheetsLeft: string;
  scrollSheetsRight: string;
  /** Placeholders of the lists to go to; `{0}` is how many there are. */
  goToSheet: string;
  goToSlide: string;
  goToHeading: string;
  /** Descriptions in those lists. */
  current: string;
  changed: string;
  /** `Page {0}` and `Page {0} of {1}` */
  page: string;
  pagePosition: string;
  /** Word comments and tracked changes; `{0}` is a number or a name. */
  comments: string;
  oneComment: string;
  goToComment: string;
  commentBy: string;
  markup: string;
  showMarkup: string;
  hideMarkup: string;
  /** The navigation pane and what it lists. */
  navigationPane: string;
  headings: string;
  slides: string;
  noHeadings: string;
  close: string;
  expand: string;
  collapse: string;
  /** PowerPoint speaker notes. */
  notes: string;
  speakerNotes: string;
  showNotes: string;
  hideNotes: string;
  /** `Slide {0}`, the accessible name of a slide. */
  slide: string;
  /** `Slide {0} of {1}`, shown in the status bar of presentations. */
  slidePosition: string;
  hiddenSlide: string;
  /** Status bar text when comparing two versions; `{0}` is a number. */
  noChanges: string;
  oneChange: string;
  changeCount: string;
  /** `Change {0} of {1}` */
  changePosition: string;
  previousChange: string;
  nextChange: string;
  /** Parts of a copied reference: `page {0}`, `under "{0}"`, `at "{0}"`, `sheet "{0}"`, `cell {0}`, … */
  refPage: string;
  refUnder: string;
  refAt: string;
  refSheet: string;
  refCell: string;
  refCells: string;
  refSlide: string;
  /** Markdown references: `line {0}`, `lines {0}-{1}`, `front matter "{0}"`. */
  refLine: string;
  refLines: string;
  refProperty: string;
  /** The front matter of a Markdown file, shown as a list of properties or as its YAML. */
  properties: string;
  showYaml: string;
  showProperties: string;
  /** `{0}` is the parser's message. */
  frontMatterError: string;
  /** The button on code blocks, and what it says once it has copied. */
  copyCode: string;
  copied: string;
  /** `{0}` is the address of a picture on the web, not shown until the user chooses to. */
  remoteImage: string;
  /** The bar above a Markdown file whose pictures from the web are hidden, and its button. */
  onlineContentHidden: string;
  showOnlineContent: string;
  showOnlineContentHint: string;
  /** `{0}` is the path of a picture that isn't there. */
  missingImage: string;
}

/** Which version a viewer shows when VS Code compares two files side by side. */
export type DiffSide = 'original' | 'modified';

/** What a viewer shares with the other side of a comparison to find the differences. */
export type DocumentSummary = WordSummary | WorkbookSummary | PresentationSummary | MarkdownSummary;

export interface WordSummary {
  format: 'docx';
  /** Text of each paragraph of the body, in order; pictures count as U+FFFC. */
  blocks: string[];
}

export interface WorkbookSummary {
  format: 'xlsx';
  /** Visible sheets, in tab order. */
  sheets: SheetSummary[];
}

export interface SheetSummary {
  name: string;
  /** Each row's displayed values, separated by `CELL_SEPARATOR` at their column positions. */
  rows: string[];
}

export interface MarkdownSummary {
  format: 'md';
  /**
   * Text of each block as rendered, in order: headings, paragraphs, list items, table rows,
   * lines of code, front matter properties. Pictures count as U+FFFC.
   */
  blocks: string[];
  /** For each block, the addresses of its pictures, so a replaced picture counts as a change. */
  pictures: string[];
}

export interface PresentationSummary {
  format: 'pptx';
  slides: SlideSummary[];
}

export interface SlideSummary {
  /** The slide's text in reading order, whitespace collapsed. */
  text: string;
  /** A fingerprint of each picture's pixels, so a replaced picture counts as a change. */
  pictures: string[];
  /** Each chart's categories and series values. */
  charts: string[];
  hidden: boolean;
  /** The speaker notes, whitespace collapsed. */
  notes: string;
}

/** Separates cells in `SheetSummary.rows`; not something a cell shows. */
export const CELL_SEPARATOR = '\u001f';

/**
 * A scroll position in the receiver's terms: `fraction` of the way through item `index`
 * (a paragraph, a slide, a row) is at the top of the window.
 */
export interface ScrollAnchor {
  index: number;
  fraction: number;
  /** For spreadsheets: the sheet, and the column and fraction of it at the left edge. */
  sheet?: string;
  column?: number;
  columnFraction?: number;
}

export interface LoadMessage {
  type: 'load';
  fileName: string;
  format: DocumentFormat;
  data: Uint8Array;
  /** True when the file changed on disk and the view should keep its position. */
  reload: boolean;
  canOpenInOffice: boolean;
  colorMode: ColorMode;
  /** Whether the navigation pane is open, as last left for this kind of file. */
  navigationPane: boolean;
  /** For Markdown: the heading to scroll to on opening, from a link to `file.md#heading`. */
  fragment?: string;
  /** For Markdown opened beside its text editor: the line (0-based) the editor shows at its top. */
  line?: number;
  /** For Markdown: the user's setting to show pictures from the web without asking. */
  onlineContent?: boolean;
  /** The user's locale, for dates and numbers shown the way their Office would. */
  locale: string;
  strings: ViewerStrings;
}

export interface ReadErrorMessage {
  type: 'readError';
  fileName: string;
  format: DocumentFormat;
  canOpenInOffice: boolean;
  strings: ViewerStrings;
}

export interface ZoomMessage {
  type: 'zoom';
  action: ZoomAction;
}

export type ZoomAction = 'in' | 'out' | 'reset';

/**
 * `goTo` lists what the document can go to: sheets, slides or headings. The copy commands act
 * on the place last right-clicked, or on the place in view when run from the Command Palette.
 */
export type ViewerCommand =
  | 'nextSheet'
  | 'previousSheet'
  | 'goTo'
  | 'find'
  | 'toggleNavigation'
  | 'copyAsMarkdown'
  | 'copyReference'
  | 'copyReferenceWithText';

export interface CommandMessage {
  type: 'command';
  command: ViewerCommand;
}

/** The viewer is one side of a comparison; `diff` with no side means it no longer is. */
export interface DiffMessage {
  type: 'diff';
  side: DiffSide | undefined;
}

export interface PeerSummaryMessage {
  type: 'peerSummary';
  summary: DocumentSummary;
}

export interface PeerScrollMessage {
  type: 'peerScroll';
  anchor: ScrollAnchor;
}

/** Selected cells of a workbook, in the receiver's rows when sent to the other side. */
export interface CellSelection {
  sheet: string;
  row1: number;
  col1: number;
  row2: number;
  col2: number;
}

export interface PeerSelectMessage {
  type: 'peerSelect';
  selection: CellSelection;
}

/** The zoom the other side was set to: a factor, or `null` for fitting the width. */
export interface PeerZoomMessage {
  type: 'peerZoom';
  zoom: number | null;
}

/** The other side of a Markdown comparison was asked to show its pictures from the web. */
export interface PeerShowOnlineMessage {
  type: 'peerShowOnline';
}

/** The item picked from the list a `pick` message asked for; -1 when it was dismissed. */
export interface PickedMessage {
  type: 'picked';
  index: number;
}

/** An entry of a list to pick from: a sheet, a slide, a heading. */
export interface PickItem {
  label: string;
  description?: string;
  /** Where the view is now; the list opens on it. */
  current?: boolean;
}

/** A picture a Markdown file links to, read by the host; no `data` when it can't be read. */
export interface ResourceMessage {
  type: 'resource';
  id: number;
  data?: Uint8Array;
  mime?: string;
}

/**
 * The text editor showing the same Markdown file scrolled: `line` (0-based, with a fraction for
 * how far into it) is at its top.
 */
export interface RevealLineMessage {
  type: 'revealLine';
  line: number;
}

export type HostToWebviewMessage =
  | LoadMessage
  | ReadErrorMessage
  | ZoomMessage
  | CommandMessage
  | DiffMessage
  | PeerSummaryMessage
  | PeerScrollMessage
  | PeerZoomMessage
  | PeerSelectMessage
  | PeerShowOnlineMessage
  | PickedMessage
  | ResourceMessage
  | RevealLineMessage;

export type WebviewToHostMessage =
  | { type: 'ready' }
  /**
   * Opens the file in the app that edits it: Office, or for Markdown VS Code's text editor, at
   * `line` (0-based) when given.
   */
  | { type: 'openInOffice'; line?: number }
  | { type: 'setColorMode'; mode: ColorMode }
  | { type: 'setNavigationPane'; open: boolean }
  | { type: 'summary'; summary: DocumentSummary }
  /** Where the other side should scroll to, in its own terms. */
  | { type: 'scroll'; anchor: ScrollAnchor }
  /** Cells the user selected while comparing, for the other side to select too. */
  | { type: 'select'; selection: CellSelection }
  /** The zoom the user set while comparing, for the other side to match. */
  | { type: 'zoomed'; zoom: number | null }
  /** The user chose to show a Markdown file's pictures from the web; the other side follows. */
  | { type: 'showOnline' }
  /** Asks VS Code to list items to pick one from; the answer is a `picked` message. */
  | { type: 'pick'; placeholder: string; items: PickItem[] }
  /** Puts text on the clipboard; `rows` says how much, for the confirmation. */
  | { type: 'copy'; text: string; rows: number }
  /**
   * A place in the document to put on the clipboard, for pasting into a chat with an AI
   * assistant or a note: the host prepends the file's path. `text` is what is there, quoted.
   */
  | { type: 'reference'; location: string; text?: string }
  /** Asks for a picture a Markdown file links to, by the address written in the file. */
  | { type: 'resource'; id: number; href: string }
  /**
   * A link followed in the document, for VS Code to open: a web or mail link, or from Markdown
   * also another file.
   */
  | { type: 'openLink'; href: string }
  /** Puts text on the clipboard, such as a code block, and says it did. */
  | { type: 'copyText'; text: string };

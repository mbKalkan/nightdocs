import type { DarkPalette } from '../../shared/color';
import type {
  CellSelection,
  DiffSide,
  DocumentSummary,
  ScrollAnchor,
  ViewerCommand,
  ViewerStrings,
} from '../../shared/protocol';
import type { OverviewMark } from '../diff/overview';
import type { ContextTarget, MarkTarget } from '../reference';

/** A place in the document for the clipboard; the host adds the file's path in front. */
export interface Reference {
  location: string;
  /** What is at the place, quoted or as a Markdown table. */
  text?: string;
}

export interface RenderOptions {
  /** Present when document colors should be adapted to a dark theme. */
  palette: DarkPalette | undefined;
  locale: string;
  strings: ViewerStrings;
  /** What `state()` of the previous render of the same file returned, to restore the view. */
  previous: unknown;
  /** For Markdown: the heading or anchor to show first, from a link to `file.md#anchor`. */
  fragment?: string;
  /** For Markdown: the source line (0-based) to show at the top, where the text editor is. */
  line?: number;
  /** For Markdown: show pictures from the web without asking (the user's setting). */
  onlineContent?: boolean;
}

/** Live parts of the viewer a rendered document can use once it is on screen. */
export interface RenderContext {
  viewport: HTMLElement;
  /** Bar under the viewport, hidden unless a document puts something in it. */
  footer: HTMLElement;
  /** Row between the viewport and the footer, for sheet tabs; hidden unless used. */
  tabBar: HTMLElement;
  /** Positioned container for floating widgets. */
  overlay: HTMLElement;
  getZoom(): number;
  setBusy(busy: boolean): void;
}

export interface RenderedDocument {
  /** Width of the widest page at 100% zoom, for fit-to-width; 0 when fitting doesn't apply. */
  naturalWidth: number;
  /**
   * False for documents drawn in the theme's own colors (Markdown), which have no original
   * colors to switch to.
   */
  adaptsColors?: boolean;
  /** Called after the rendered content has been moved into the visible viewport. */
  activate?(context: RenderContext): void;
  /** Called when the zoom level changes. */
  refresh?(): void;
  command?(command: ViewerCommand): void;
  /**
   * Describes a place: what was right-clicked (`hit`), or what is in view without one. With
   * `withText`, also the selected text or what is at the place.
   */
  reference?(hit: ContextTarget | undefined, withText: boolean): Reference | undefined;
  /** What a reference to a right-clicked place points at, to mark while the menu is open. */
  referenceMark?(hit: ContextTarget): MarkTarget | undefined;
  /** What the navigation pane lists for this document, made when the pane opens. */
  navigation?(context: RenderContext): NavigationContent | undefined;
  /**
   * For text formats: the line (0-based) at the top of the view, where the text editor should
   * open; and scrolling to show a line the text editor shows at its top.
   */
  sourceLine?(): number | undefined;
  revealLine?(line: number): void;
  /** View state to carry over when the same file is rendered again. */
  state?(): unknown;
  /** What the other side of a comparison needs to find the differences. */
  summary?(): DocumentSummary | Promise<DocumentSummary>;
  /** Marks where this document differs from the other side's, once it is on screen. */
  compare?(
    peer: DocumentSummary,
    side: DiffSide,
    context: RenderContext,
  ): Comparison | undefined | Promise<Comparison | undefined>;
  dispose?(): void;
}

/** A document's part of the navigation pane. */
export interface NavigationContent {
  /** What it lists: Headings, Slides, Sheets. */
  title: string;
  element: HTMLElement;
  dispose(): void;
}

/** The differences marked in one side of a comparison. */
export interface Comparison {
  /** How many changes there are; each is a run of edits next to each other. */
  readonly count: number;
  /**
   * Brings the next (1) or previous (-1) change from where the view is into view, wrapping
   * around at the ends, and returns its number (0-based).
   */
  go(direction: 1 | -1): number | undefined | Promise<number | undefined>;
  /** Where the other side should scroll to so that the same content is at the top. */
  anchor(): ScrollAnchor | undefined;
  /** Scrolls to a position the other side sent. */
  scrollTo(anchor: ScrollAnchor): void | Promise<void>;
  /** Where the changes are, for the overview ruler beside the scrollbar; in `go`'s order. */
  overview?(): OverviewMark[];
  /** Brings change `index` (0-based, in `go`'s order) into view. */
  goTo?(index: number): void | Promise<void>;
  /** Selects the cells the other side selected, in this side's rows. */
  select?(selection: CellSelection): void | Promise<void>;
  /** Removes the marks. */
  dispose(): void;
}

export interface Renderer {
  /** Renders into `target`, which is attached to the document but not visible. */
  render(data: Uint8Array, target: HTMLElement, options: RenderOptions): Promise<RenderedDocument>;
}

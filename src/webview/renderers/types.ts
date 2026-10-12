import type { DarkPalette } from '../../shared/color';
import type {
  DiffSide,
  DocumentSummary,
  ScrollAnchor,
  ViewerCommand,
  ViewerStrings,
} from '../../shared/protocol';

export interface RenderOptions {
  /** Present when document colors should be adapted to a dark theme. */
  palette: DarkPalette | undefined;
  locale: string;
  strings: ViewerStrings;
  /** What `state()` of the previous render of the same file returned, to restore the view. */
  previous: unknown;
}

/** Live parts of the viewer a rendered document can use once it is on screen. */
export interface RenderContext {
  viewport: HTMLElement;
  /** Bar under the viewport, hidden unless a document puts something in it. */
  footer: HTMLElement;
  /** Positioned container for floating widgets. */
  overlay: HTMLElement;
  getZoom(): number;
  setBusy(busy: boolean): void;
}

export interface RenderedDocument {
  /** Width of the widest page at 100% zoom, for fit-to-width; 0 when fitting doesn't apply. */
  naturalWidth: number;
  /** Called after the rendered content has been moved into the visible viewport. */
  activate?(context: RenderContext): void;
  /** Called when the zoom level changes. */
  refresh?(): void;
  command?(command: ViewerCommand): void;
  /** View state to carry over when the same file is rendered again. */
  state?(): unknown;
  /** What the other side of a comparison needs to find the differences. */
  summary?(): DocumentSummary;
  /** Marks where this document differs from the other side's, once it is on screen. */
  compare?(peer: DocumentSummary, side: DiffSide, context: RenderContext): Comparison | undefined;
  dispose?(): void;
}

/** The differences marked in one side of a comparison. */
export interface Comparison {
  /** Scroll position of each change in this document, top to bottom. */
  changeTops(): number[];
  /** Where the other side should scroll to so that the same content is at the top. */
  anchor(): ScrollAnchor | undefined;
  /** Scrolls to a position the other side sent. */
  scrollTo(anchor: ScrollAnchor): void;
  /** Removes the marks. */
  dispose(): void;
}

export interface Renderer {
  /** Renders into `target`, which is attached to the document but not visible. */
  render(data: Uint8Array, target: HTMLElement, options: RenderOptions): Promise<RenderedDocument>;
}

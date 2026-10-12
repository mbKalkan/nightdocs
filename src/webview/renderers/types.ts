export interface RenderedDocument {
  /** Width of the widest page at 100% zoom, in CSS pixels, including the gutter around it. */
  naturalWidth: number;
}

export interface Renderer {
  /** Renders into `target`, which is attached to the document but not visible. */
  render(data: Uint8Array, target: HTMLElement): Promise<RenderedDocument>;
}

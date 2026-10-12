import { renderAsync } from 'docx-preview';
import type { RenderedDocument, Renderer } from './types';

/** Horizontal space around pages; matches the padding of `.docx-wrapper` in viewer.css. */
const PAGE_GUTTER = 2 * 32;

export const docxRenderer: Renderer = {
  async render(data: Uint8Array, target: HTMLElement): Promise<RenderedDocument> {
    await renderAsync(data, target, undefined, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      // Word records where it broke pages on its last save; reuse that for real pagination.
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderComments: false,
      renderChanges: false,
      // Embedded HTML chunks would need frames, which the webview's CSP blocks.
      renderAltChunks: false,
      useBase64URL: false,
      experimental: true,
    });

    const pages = target.querySelectorAll<HTMLElement>('.docx-wrapper > section.docx');
    const widest = Math.max(0, ...Array.from(pages, (page) => page.offsetWidth));
    return { naturalWidth: widest + PAGE_GUTTER };
  },
};

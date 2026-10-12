import { renderAsync } from 'docx-preview';
import { adaptDocumentColors } from '../darkColors';
import { paginate } from '../paginate';
import type { RenderedDocument, RenderOptions, Renderer } from './types';

/** Horizontal space around pages; matches the padding of `.docx-wrapper` in viewer.css. */
const PAGE_GUTTER = 2 * 32;

export const docxRenderer: Renderer = {
  async render(
    data: Uint8Array,
    target: HTMLElement,
    options: RenderOptions,
  ): Promise<RenderedDocument> {
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

    // Page breaks depend on text metrics, so wait for the document's fonts first.
    await document.fonts.ready;
    const wrapper = target.querySelector<HTMLElement>('.docx-wrapper');
    if (wrapper) paginate(wrapper);

    if (options.palette) {
      adaptDocumentColors(target, options.palette);
    }

    const pages = target.querySelectorAll<HTMLElement>('.docx-wrapper > section.docx');
    const widest = Math.max(0, ...Array.from(pages, (page) => page.offsetWidth));
    return { naturalWidth: widest + PAGE_GUTTER };
  },
};

import type { DocumentFormat } from '../../shared/protocol';
import type { Renderer } from './types';

// Each format is a separate chunk, so opening a Word file never loads the Excel or PowerPoint code.
const loaders: Record<DocumentFormat, () => Promise<Renderer>> = {
  docx: () => import('./docx').then((m) => m.docxRenderer),
  xlsx: () => import('./xlsx').then((m) => m.xlsxRenderer),
  pptx: () => import('./pptx').then((m) => m.pptxRenderer),
};

export function loadRenderer(format: DocumentFormat): Promise<Renderer> {
  return loaders[format]();
}

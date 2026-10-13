import JSZip from 'jszip';

const PRESENTATION_ML = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAWING_ML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NOTES_SLIDE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

/**
 * The speaker notes of each slide, as paragraphs, from the notes pages the slides link to.
 * `slidePaths` are the slides' parts, like `ppt/slides/slide3.xml`. pptx-renderer doesn't read
 * notes pages, so they come from the package itself.
 */
export async function readNotes(
  data: Uint8Array,
  slidePaths: readonly string[],
): Promise<string[][]> {
  const zip = await JSZip.loadAsync(data);
  const parser = new DOMParser();
  const read = async (path: string) => {
    const file = zip.file(path);
    return file ? parser.parseFromString(await file.async('string'), 'application/xml') : undefined;
  };
  return Promise.all(
    slidePaths.map(async (slidePath) => {
      const folder = slidePath.slice(0, slidePath.lastIndexOf('/'));
      const name = slidePath.slice(folder.length + 1);
      const rels = await read(`${folder}/_rels/${name}.rels`);
      const target = [...(rels?.getElementsByTagName('Relationship') ?? [])]
        .find((relationship) => relationship.getAttribute('Type') === NOTES_SLIDE)
        ?.getAttribute('Target');
      if (!target) return [];
      const notes = await read(resolve(folder, target));
      return notes ? notesText(notes) : [];
    }),
  );
}

/** The paragraphs of a notes page's body placeholder, without its slide picture and number. */
function notesText(notes: Document): string[] {
  const paragraphs: string[] = [];
  for (const shape of notes.getElementsByTagNameNS(PRESENTATION_ML, 'sp')) {
    const placeholder = shape.getElementsByTagNameNS(PRESENTATION_ML, 'ph')[0];
    if (placeholder?.getAttribute('type') !== 'body') continue;
    for (const paragraph of shape.getElementsByTagNameNS(DRAWING_ML, 'p')) {
      let text = '';
      for (const node of paragraph.getElementsByTagNameNS(DRAWING_ML, '*')) {
        if (node.localName === 't') text += node.textContent ?? '';
        else if (node.localName === 'br') text += '\n';
      }
      paragraphs.push(text);
    }
  }
  // Notes pages often end in empty paragraphs.
  while (paragraphs.length > 0 && !paragraphs[paragraphs.length - 1].trim()) paragraphs.pop();
  return paragraphs.some((paragraph) => paragraph.trim()) ? paragraphs : [];
}

/** Resolves a relationship target against the folder of the part it belongs to. */
function resolve(folder: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = folder.split('/');
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

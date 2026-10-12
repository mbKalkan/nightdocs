// Minimal XML scanning for the SpreadsheetML parts we read. Workers have no DOMParser, and
// these schemas are flat enough that a regex scanner is both simpler and much faster.

export interface XmlElement {
  attrs: Record<string, string>;
  /** Inner XML, or '' for self-closing elements. */
  body: string;
}

const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    attrs[localName(match[1])] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

/**
 * Iterates elements named `name` (with any namespace prefix) in document order. Elements
 * of the same name must not nest, which holds for every element we look up.
 */
export function* elements(xml: string, name: string): Generator<XmlElement> {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${name}(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>)`,
    'g',
  );
  for (const match of xml.matchAll(pattern)) {
    yield { attrs: parseAttributes(match[1]), body: match[2] ?? '' };
  }
}

export function firstElement(xml: string, name: string): XmlElement | undefined {
  return elements(xml, name).next().value ?? undefined;
}

/** Text content of all `<t>` runs, as in shared strings and inline strings; skips phonetic runs. */
export function textRuns(xml: string): string {
  const withoutPhonetic = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  let text = '';
  for (const run of elements(withoutPhonetic, 't')) {
    text += decodeEntities(run.body);
  }
  return text;
}

export function decodeEntities(value: string): string {
  if (!value.includes('&') && !value.includes('_x')) {
    return value;
  }
  return (
    value
      .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_, dec, hex, named) => {
        if (dec) return String.fromCodePoint(parseInt(dec, 10));
        if (hex) return String.fromCodePoint(parseInt(hex, 16));
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named.toLowerCase() as 'amp'];
      })
      // Excel escapes control characters as _xHHHH_.
      .replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  );
}

function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 || name.startsWith('xmlns') ? name : name.slice(colon + 1);
}

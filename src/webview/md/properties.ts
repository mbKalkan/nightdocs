import type { ViewerStrings } from '../../shared/protocol';
import { icons } from '../icons';
import type { FrontMatter } from './frontmatter';

/**
 * Keys whose value is a list even when written as one string with commas, as AI tools take
 * their `tools: Read, Grep, Glob` and Cursor its `globs: *.ts, *.tsx`.
 */
const LIST_KEYS =
  /^(tools|allowed[-_]?tools|disallowed[-_]?tools|tags|keywords|globs|categories|aliases|topics)$/i;

export interface PropertiesView {
  element: HTMLElement;
  /** Whether the YAML is shown instead of the list of properties. */
  showingSource: boolean;
  /** Shows the YAML (true) or the list of properties (false), when there is a list. */
  show(source: boolean): void;
}

/**
 * The front matter as a card of properties above the document, like a note app shows them:
 * text, numbers, yes/no, lists as chips, nested properties indented. A toggle shows the YAML as
 * written; YAML that doesn't parse is reported with its line, with the source shown.
 */
export function renderProperties(
  frontMatter: FrontMatter,
  strings: ViewerStrings,
  showSource: boolean,
): PropertiesView | undefined {
  if (!frontMatter.source.trim()) return undefined;
  const { data, error } = frontMatter;
  const section = document.createElement('section');
  section.className = 'md-props';
  section.dataset.line = String(frontMatter.firstLine);
  section.dataset.lineEnd = String(frontMatter.firstLine + frontMatter.lineCount);
  section.setAttribute('aria-label', strings.properties);

  const header = document.createElement('div');
  header.className = 'md-props-header';
  const title = document.createElement('span');
  title.className = 'md-props-title';
  title.textContent = strings.properties;
  header.innerHTML = icons.braces;
  header.append(title);
  const entries = data ? Object.entries(data) : [];
  if (data) {
    const count = document.createElement('span');
    count.className = 'md-props-count';
    count.textContent = String(entries.length);
    header.append(count);
  }
  const language = document.createElement('span');
  language.className = 'md-props-language';
  language.textContent = frontMatter.language.toUpperCase();
  header.append(language);
  section.append(header);

  if (error) {
    const message = document.createElement('div');
    message.className = 'md-props-error';
    message.setAttribute('role', 'note');
    message.innerHTML = icons.warning;
    const text = document.createElement('span');
    const where =
      error.line !== undefined
        ? ` (${strings.refLine.replace('{0}', String(error.line + 1))})`
        : '';
    text.textContent = strings.frontMatterError.replace('{0}', `${error.message}${where}`);
    message.append(text);
    section.append(message);
  }

  const source = sourceBlock(frontMatter);
  if (!data) {
    section.append(source);
    return { element: section, showingSource: true, show: () => {} };
  }

  const list = document.createElement('dl');
  list.className = 'md-props-list';
  const lines = [...frontMatter.keyLines.values()].sort((a, b) => a - b);
  const closing = frontMatter.firstLine + frontMatter.lineCount - 1;
  const seen = new Set<object>();
  for (const [key, value] of entries) {
    const row = property(key, value, seen);
    const line = frontMatter.keyLines.get(key);
    if (line !== undefined) {
      row.dataset.line = String(line);
      row.dataset.lineEnd = String(lines.find((next) => next > line) ?? closing);
    }
    row.dataset.key = key;
    list.append(row);
  }
  if (entries.length > 0) section.append(list);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ov-icon-button md-props-toggle';
  toggle.innerHTML = icons.code;
  toggle.setAttribute('aria-label', strings.showYaml);
  header.append(toggle);
  section.append(source);
  const view: PropertiesView = {
    element: section,
    showingSource: showSource,
    show(yaml) {
      const shown = yaml || entries.length === 0;
      view.showingSource = shown;
      list.hidden = shown;
      source.hidden = !shown;
      toggle.setAttribute('aria-pressed', String(shown));
      toggle.title = shown ? strings.showProperties : strings.showYaml;
    },
  };
  toggle.addEventListener('click', () => view.show(!view.showingSource));
  view.show(showSource);
  return view;
}

/** The front matter as written, highlighted like a code block. */
function sourceBlock(frontMatter: FrontMatter): HTMLElement {
  const block = document.createElement('div');
  block.className = 'md-code md-props-source';
  block.dataset.lang = frontMatter.language === 'yaml' ? 'yaml' : 'toml';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  frontMatter.source.split('\n').forEach((text, i) => {
    const line = document.createElement('span');
    line.className = 'md-line';
    const number = frontMatter.firstLine + 1 + i;
    line.dataset.line = String(number);
    line.dataset.lineEnd = String(number + 1);
    line.textContent = `${text}\n`;
    code.append(line);
  });
  pre.append(code);
  block.append(pre);
  return block;
}

function property(key: string, value: unknown, seen: Set<object>): HTMLElement {
  const row = document.createElement('div');
  row.className = 'md-prop';
  const name = document.createElement('dt');
  name.textContent = key;
  const content = document.createElement('dd');
  content.append(valueOf(value, seen, LIST_KEYS.test(key)));
  row.append(name, content);
  return row;
}

/**
 * How a value shows. A YAML alias (`*name`) brings back a value already shown, and can even
 * contain itself; such a value shows once, then as `…`, so the card stays small and finite.
 */
function valueOf(value: unknown, seen: Set<object>, listLike = false): Node {
  if (value === null || value === undefined) return span('md-prop-null', 'null');
  if (typeof value === 'object') {
    if (seen.has(value)) return span('md-prop-null', '…');
    seen.add(value);
  }
  if (typeof value === 'boolean') {
    const element = span('md-prop-bool', String(value));
    element.dataset.value = String(value);
    element.insertAdjacentHTML('afterbegin', value ? icons.check : icons.close);
    return element;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return span('md-prop-number', String(value));
  }
  if (typeof value === 'string') {
    if (listLike && value.includes(',')) {
      return chips(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );
    }
    if (/^https?:\/\/\S+$/.test(value)) {
      const link = document.createElement('a');
      link.href = value;
      link.textContent = value;
      return link;
    }
    return span(value.includes('\n') ? 'md-prop-text md-prop-multiline' : 'md-prop-text', value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return span('md-prop-null', '[ ]');
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return chips(value.map((item) => String(item)));
    }
    const list = document.createElement('ol');
    list.className = 'md-prop-items';
    for (const item of value) {
      const entry = document.createElement('li');
      entry.append(valueOf(item, seen));
      list.append(entry);
    }
    return list;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return span('md-prop-null', '{ }');
    const nested = document.createElement('dl');
    nested.className = 'md-props-list md-props-nested';
    for (const [key, item] of entries) nested.append(property(key, item, seen));
    return nested;
  }
  return span('md-prop-text', String(value));
}

/** Items as chips; spaces between them keep the words apart when copied or compared. */
function chips(items: readonly string[]): HTMLElement {
  const list = document.createElement('span');
  list.className = 'md-chips';
  items.forEach((item, i) => {
    if (i > 0) list.append(' ');
    list.append(span('md-chip', item));
  });
  return list;
}

function span(className: string, text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

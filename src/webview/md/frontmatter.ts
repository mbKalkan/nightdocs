import { CORE_SCHEMA, load } from 'js-yaml';

/**
 * The block of properties at the top of a Markdown file, between `---` lines (YAML) or `+++`
 * lines (TOML), as static site generators and AI tools (agents, skills, rules, prompts) use it.
 */
export interface FrontMatter {
  language: 'yaml' | 'toml';
  /** The text between the fences. */
  source: string;
  /** The line (0-based) of the opening fence; the source starts on the next one. */
  firstLine: number;
  /** How many lines it takes, fences included. */
  lineCount: number;
  /** The properties, in the order written; undefined for TOML and for YAML that isn't valid. */
  data?: Record<string, unknown>;
  /** Why the YAML isn't valid, and the line (0-based, in the file) it went wrong on. */
  error?: { message: string; line?: number };
  /** The line (0-based, in the file) each top-level property starts on. */
  keyLines: Map<string, number>;
}

export interface SplitResult {
  frontMatter?: FrontMatter;
  /**
   * The rest of the file, with the front matter's lines left blank so that line numbers stay
   * those of the file.
   */
  body: string;
}

const FENCES = { yaml: /^---[ \t]*$/, toml: /^\+\+\+[ \t]*$/ } as const;
/** YAML may also end a document with `...`. */
const YAML_END = /^(?:---|\.\.\.)[ \t]*$/;

/** Separates the front matter, if the file starts with one, from the Markdown after it. */
export function splitFrontMatter(text: string): SplitResult {
  const lines = text.split('\n');
  const language = FENCES.yaml.test(lines[0]) ? 'yaml' : FENCES.toml.test(lines[0]) ? 'toml' : '';
  if (!language) return { body: text };
  const end = language === 'yaml' ? YAML_END : FENCES.toml;
  const close = lines.findIndex((line, index) => index > 0 && end.test(line));
  // Without a closing fence it isn't front matter; `---` is then a rule or a heading underline.
  if (close < 0) return { body: text };

  const source = lines.slice(1, close).join('\n');
  const lineCount = close + 1;
  const frontMatter: FrontMatter = {
    language,
    source,
    firstLine: 0,
    lineCount,
    keyLines: keyLines(lines.slice(1, close), 1),
  };
  if (language === 'yaml') Object.assign(frontMatter, parseYaml(source, 1));
  const body = '\n'.repeat(lineCount) + lines.slice(lineCount).join('\n');
  return { frontMatter, body };
}

/**
 * Reads YAML properties. Dates stay as written (no timestamp type), since a viewer shows what
 * the file says. A document that is empty counts as no properties; one that isn't a mapping
 * (a list, a single value) is reported, as tools reading front matter expect properties.
 */
function parseYaml(source: string, offset: number): Pick<FrontMatter, 'data' | 'error'> {
  // Nothing but blank lines and comments: no properties (the parser calls that an error).
  if (source.split('\n').every((line) => /^\s*(#.*)?$/.test(line))) return { data: {} };
  try {
    const value: unknown = load(source, { schema: CORE_SCHEMA });
    if (value === null || value === undefined) return { data: {} };
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { error: { message: 'expected properties (key: value) at the top level' } };
    }
    return { data: value as Record<string, unknown> };
  } catch (error) {
    const { reason, mark, message } = error as {
      reason?: string;
      mark?: { line?: number };
      message?: string;
    };
    const line = typeof mark?.line === 'number' ? mark.line + offset : undefined;
    return { error: { message: reason ?? message ?? String(error), line } };
  }
}

const KEY =
  /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#:'"-][^:]*?|-[^\s:][^:]*?))[ \t]*:(?:[ \t]|$)/;

/** Where each top-level key starts: a line that isn't indented, a comment or a list item. */
function keyLines(lines: readonly string[], offset: number): Map<string, number> {
  const found = new Map<string, number>();
  lines.forEach((line, index) => {
    const match = KEY.exec(line);
    if (!match) return;
    const key = match[1] ?? match[2]?.replace(/''/g, "'") ?? match[3];
    if (key !== undefined && !found.has(key)) found.set(key, index + offset);
  });
  return found;
}

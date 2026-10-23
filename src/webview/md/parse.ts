import markdownIt from 'markdown-it';
import type { MarkdownIt, StateBlock, StateCore, Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { isHtmlTag } from './htmlTags';

/**
 * Markdown as GitHub renders it (tables, task lists, strikethrough, footnotes, alerts, bare
 * links), with every block keeping the lines it came from (`data-line`, `data-line-end`,
 * 0-based, end exclusive) for references, scrolling along with the text editor and diffs.
 *
 * Raw HTML is let through to be sanitized afterwards, except tags HTML doesn't know, such as
 * the `<example>` or `<instructions>` of prompts written for AI models: those are shown.
 */
export function createParser(): MarkdownIt {
  // Quotes and dashes stay as typed: the view shows what the file says.
  const md = markdownIt({ html: true, linkify: true, typographer: false });
  md.use(footnote);
  md.block.ruler.before('html_block', 'nd_xml_tag', xmlTagLine, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.core.ruler.push('nd_xml_pairs', pairXmlTags);
  md.core.ruler.push('nd_alerts', alerts);
  md.core.ruler.push('nd_tasks', taskLists);
  md.core.ruler.push('nd_headings', headingIds);
  md.core.ruler.push('nd_tables', tableAlignment);
  md.core.ruler.push('nd_lines', sourceLines);
  renderRules(md);
  return md;
}

/** Puts on every block the lines (0-based, end exclusive) it was written on. */
function sourceLines(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.map && token.block && token.nesting !== -1 && token.type !== 'inline') {
      token.attrSet('data-line', token.map[0]);
      token.attrSet('data-line-end', token.map[1]);
    }
  }
}

/** GitHub's heading ids: lowercase, punctuation dropped, spaces as dashes, repeats numbered. */
export function slugger(): (text: string) => string {
  const seen = new Set<string>();
  return (text) => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
      .replace(/ /g, '-');
    let slug = base;
    for (let n = 1; seen.has(slug); n++) slug = `${base}-${n}`;
    seen.add(slug);
    return slug;
  };
}

function headingIds(state: StateCore): void {
  const slug = slugger();
  state.tokens.forEach((token, index) => {
    if (token.type !== 'heading_open') return;
    const inline = state.tokens[index + 1];
    // Not an `id`: the sanitizer drops ids that clash with DOM names (`title`, `images`).
    token.attrSet('data-anchor', slug(plainText(inline)));
  });
}

/** The text of an inline token without its markup. */
export function plainText(inline: Token | undefined): string {
  return (inline?.children ?? [])
    .map((child) => (child.type === 'text' || child.type === 'code_inline' ? child.content : ''))
    .join('');
}

const TASK = /^\[([ xX])\][ \t]+/;

/** `- [ ] item` and `- [x] item`; the box is drawn after sanitizing, from a placeholder. */
function taskLists(state: StateCore): void {
  const { tokens } = state;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (
      inline.type !== 'inline' ||
      tokens[i - 1].type !== 'paragraph_open' ||
      tokens[i - 2].type !== 'list_item_open'
    ) {
      continue;
    }
    const first = inline.children?.[0];
    const match = first?.type === 'text' ? TASK.exec(first.content) : null;
    if (!first || !match) continue;
    first.content = first.content.slice(match[0].length);
    inline.content = inline.content.slice(match[0].length);
    const box = new state.Token('html_inline', '', 0);
    box.content = `<span class="md-task-box" data-checked="${match[1] !== ' '}"></span>`;
    box.meta = { trusted: true };
    inline.children!.unshift(box);
    tokens[i - 2].attrJoin('class', 'md-task');
  }
}

const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i;

/** GitHub's alerts: a quote whose first line is `[!NOTE]`, `[!TIP]`, `[!WARNING]`… */
function alerts(state: StateCore): void {
  const { tokens } = state;
  for (let i = 0; i < tokens.length - 2; i++) {
    const [open, paragraph, inline] = [tokens[i], tokens[i + 1], tokens[i + 2]];
    if (open.type !== 'blockquote_open' || paragraph.type !== 'paragraph_open') continue;
    const children = inline.children ?? [];
    const match = children[0]?.type === 'text' ? ALERT.exec(children[0].content) : null;
    const next = children[1];
    if (!match || (next && next.type !== 'softbreak' && next.type !== 'hardbreak')) continue;

    const kind = match[1].toLowerCase();
    open.attrJoin('class', `md-alert md-alert-${kind}`);
    children.splice(0, next ? 2 : 1);
    inline.content = inline.content.replace(/^[^\n]*\n?/, '');
    const title = new state.Token('html_block', '', 0);
    title.content = `<p class="md-alert-title" data-alert="${kind}">${kind[0].toUpperCase()}${kind.slice(1)}</p>\n`;
    title.meta = { trusted: true };
    title.map = paragraph.map && [paragraph.map[0], paragraph.map[0] + 1];
    if (children.length === 0) {
      // The marker was the whole paragraph; its text follows in the next one.
      tokens.splice(i + 1, 3, title);
    } else {
      tokens.splice(i + 1, 0, title);
    }
  }
}

/** Table cell alignment as classes; inline styles are dropped when sanitizing. */
function tableAlignment(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type !== 'th_open' && token.type !== 'td_open') continue;
    const style = token.attrGet('style');
    const align = typeof style === 'string' ? /text-align:\s*(\w+)/.exec(style)?.[1] : undefined;
    if (!align) continue;
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
    token.attrJoin('class', `md-align-${align}`);
  }
}

const XML_TAG_LINE = /^<(\/?)([A-Za-z][\w.:-]*)((?:\s[^<>]*?)?)\s*(\/?)>\s*$/;

/**
 * A line that is just a tag HTML doesn't know, such as `<example>` or `</instructions>`. These
 * structure prompts for AI models; a browser would hide them and GitHub drops them, which loses
 * what a prompt says. Unlike HTML blocks, they can interrupt a paragraph, as prompts are
 * written with no blank line around them.
 */
function xmlTagLine(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const line = state.src.slice(start, state.eMarks[startLine]);
  const match = XML_TAG_LINE.exec(line);
  if (!match || isHtmlTag(match[2])) return false;
  if (silent) return true;
  const [, closing, name, attributes, selfClosing] = match;
  const token = state.push(closing ? 'nd_xml_close' : 'nd_xml_open', 'div', 0);
  token.map = [startLine, startLine + 1];
  token.meta = { name, attributes: attributes.trim(), selfClosing: Boolean(selfClosing) };
  state.line = startLine + 1;
  return true;
}

/**
 * Pairs each closing tag with the opening one it closes, in the same container (the document,
 * a quote, a list item), so the content between them can be framed. Tags left unpaired are
 * shown as they are.
 */
function pairXmlTags(state: StateCore): void {
  const containers: Token[] = [];
  const open: { token: Token; container: Token | undefined }[] = [];
  for (const token of state.tokens) {
    if (token.nesting === 1) containers.push(token);
    else if (token.nesting === -1) containers.pop();
    const meta = token.meta as unknown as XmlMeta | null;
    if (token.type === 'nd_xml_open' && meta && !meta.selfClosing) {
      open.push({ token, container: containers[containers.length - 1] });
    } else if (token.type === 'nd_xml_close' && meta) {
      const container = containers[containers.length - 1];
      for (let i = open.length - 1; i >= 0; i--) {
        const candidate = open[i];
        if (candidate.container !== container) break;
        const candidateMeta = candidate.token.meta as unknown as XmlMeta;
        if (candidateMeta.name !== meta.name) continue;
        candidateMeta.paired = true;
        meta.paired = true;
        open.splice(i);
        break;
      }
    }
  }
}

interface XmlMeta {
  name: string;
  attributes: string;
  selfClosing: boolean;
  paired?: boolean;
}

const VOID_ELEMENTS = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
);

/** Whether HTML closes every element it opens, and opens every element it closes. */
export function isBalanced(html: string): boolean {
  const open: string[] = [];
  const text = html.replace(/<!--[\s\S]*?(-->|$)/g, '');
  for (const [tag, closing, name, selfClosing] of text.matchAll(
    /<(\/?)([a-zA-Z][\w-]*)(?:\s[^<>]*?)?(\/?)>/g,
  )) {
    const element = name.toLowerCase();
    if (!tag || VOID_ELEMENTS.has(element) || selfClosing) continue;
    if (!closing) open.push(element);
    else if (open.pop() !== element) return false;
  }
  return open.length === 0;
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const lineAttributes = (token: Token, renderAttrs: (token: Token) => string) =>
  renderAttrs({
    attrs: (token.attrs ?? []).filter(([name]) => name.startsWith('data-line')),
  } as Token);

function renderRules(md: MarkdownIt): void {
  const rules = md.renderer.rules;
  const attrs = (token: Token) => md.renderer.renderAttrs(token);

  // Paragraphs of tight list items are hidden by default; keep them as elements to mark.
  rules.paragraph_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx];
    if (!token.hidden) return self.renderToken(tokens, idx, options);
    token.attrJoin('class', 'md-tight');
    return `<p${attrs(token)}>`;
  };
  rules.paragraph_close = (tokens, idx, options, _env, self) =>
    tokens[idx].hidden ? '</p>' : self.renderToken(tokens, idx, options);

  rules.table_open = (tokens, idx) => `<div class="md-table"${attrs(tokens[idx])}><table>\n`;
  rules.table_close = () => '</table></div>\n';

  // Each line of code is its own element, so a diff can mark lines and a reference name one.
  const code = (token: Token, language: string) => {
    const first = (token.map?.[0] ?? 0) + (token.type === 'fence' ? 1 : 0);
    const lines = token.content.replace(/\n$/, '').split('\n');
    const body = lines
      .map(
        (line, i) =>
          `<span class="md-line" data-line="${first + i}" data-line-end="${first + i + 1}">${escape(line)}\n</span>`,
      )
      .join('');
    const lang = language ? ` data-lang="${escape(language)}"` : '';
    return `<div class="md-code"${lineAttributes(token, attrs)}${lang}><pre><code>${body}</code></pre></div>\n`;
  };
  rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    return code(token, token.info.trim().split(/\s+/)[0] ?? '');
  };
  rules.code_block = (tokens, idx) => code(tokens[idx], '');

  // HTML that closes all it opens is framed to carry its lines. HTML that spans Markdown, like
  // `<details>` … Markdown … `</details>`, has to stay unframed to keep its structure; a hidden
  // marker before it carries the lines instead.
  rules.html_block = (tokens, idx) => {
    const token = tokens[idx];
    if ((token.meta as { trusted?: boolean } | null)?.trusted) return token.content;
    const lines = lineAttributes(token, attrs);
    return isBalanced(token.content)
      ? `<div class="md-html"${lines}>${token.content}</div>\n`
      : `<span class="md-html-line"${lines}></span>${token.content}`;
  };

  // GitHub numbers footnote references without brackets.
  rules.footnote_caption = (tokens, idx) => {
    const meta = tokens[idx].meta as { id: number; subId: number };
    return `${meta.id + 1}${meta.subId > 0 ? `:${meta.subId}` : ''}`;
  };

  // Inline tags HTML doesn't know are shown as written, like `Answer in <answer> tags`.
  rules.html_inline = (tokens, idx) => {
    const token = tokens[idx];
    if ((token.meta as { trusted?: boolean } | null)?.trusted) return token.content;
    const name = /^<\/?([A-Za-z][\w.:-]*)/.exec(token.content)?.[1];
    return name && !isHtmlTag(name)
      ? `<code class="md-xml-inline">${escape(token.content)}</code>`
      : token.content;
  };

  const tag = (token: Token, text: string, extra = '') =>
    `<div class="md-xml-tag${extra}"${lineAttributes(token, attrs)}>${escape(text)}</div>`;
  rules.nd_xml_open = (tokens, idx) => {
    const token = tokens[idx];
    const meta = token.meta as unknown as XmlMeta;
    const written = `<${meta.name}${meta.attributes ? ` ${meta.attributes}` : ''}${meta.selfClosing ? ' /' : ''}>`;
    return meta.paired
      ? `<div class="md-xml" data-tag="${escape(meta.name)}">${tag(token, written)}<div class="md-xml-body">\n`
      : `${tag(token, written)}\n`;
  };
  rules.nd_xml_close = (tokens, idx) => {
    const token = tokens[idx];
    const meta = token.meta as unknown as XmlMeta;
    return meta.paired
      ? `</div>${tag(token, `</${meta.name}>`, ' md-xml-end')}</div>\n`
      : `${tag(token, `</${meta.name}>`)}\n`;
  };
}

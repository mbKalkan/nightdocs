import * as vscode from 'vscode';
import { MARKDOWN_EXTENSIONS } from '../shared/formats';
import { hasScheme, isExternalLink, lineFragment, pictureType, resolveHref } from './markdownLinks';

/** The viewer for Markdown; VS Code's text editor stays the default for these files. */
export const MARKDOWN_VIEW_TYPE = 'nightdocs.markdown';

/** Pictures bigger than this aren't read into the view. */
const MAX_PICTURE_BYTES = 25 * 1024 * 1024;

export const isMarkdown = (uri: vscode.Uri) =>
  MARKDOWN_EXTENSIONS.some((extension) => uri.path.toLowerCase().endsWith(extension));

const sameFile = (a: vscode.Uri, b: vscode.Uri) => a.toString() === b.toString();

/** Comparisons switched back to text with Edit; they stay text for the rest of the session. */
const keptAsText = new Set<string>();
/** Edit is switching a comparison to text: the next text comparison is that one. */
let switchingToText = false;

const comparisonKey = ({ original, modified }: vscode.TabInputTextDiff) =>
  `${original.toString()} ${modified.toString()}`;

/**
 * What a Markdown file's links resolve against. A version from Git (the old side of a
 * comparison) links to the files on disk, as the file it is a version of does.
 */
function linkBase(document: vscode.Uri): vscode.Uri {
  return document.scheme === 'git' ? document.with({ scheme: 'file', query: '' }) : document;
}

/** The file a link or picture path written in `document` points at. */
export function resolveLink(
  document: vscode.Uri,
  href: string,
): { uri: vscode.Uri; fragment?: string } | undefined {
  if (/^file:/i.test(href)) {
    const uri = vscode.Uri.parse(href);
    return { uri: uri.with({ fragment: '' }), fragment: uri.fragment || undefined };
  }
  const base = linkBase(document);
  const folder = vscode.workspace.getWorkspaceFolder(base)?.uri;
  const resolved = resolveHref(base.path, href, folder?.path);
  if (!resolved) return undefined;
  return {
    uri: base.with({ path: resolved.path, query: '', fragment: '' }),
    fragment: resolved.fragment,
  };
}

/** Reads a picture a Markdown file shows, if `href` is a picture next to it. */
export async function readPicture(
  document: vscode.Uri,
  href: string,
): Promise<{ data: Uint8Array; mime: string } | undefined> {
  const target = resolveLink(document, href);
  const mime = target && pictureType(target.uri.path);
  if (!target || !mime) return undefined;
  try {
    const { size } = await vscode.workspace.fs.stat(target.uri);
    if (size > MAX_PICTURE_BYTES) return undefined;
    return { data: await vscode.workspace.fs.readFile(target.uri), mime };
  } catch {
    return undefined;
  }
}

/**
 * Follows a link clicked in a Markdown file: web pages open in the browser (VS Code asks first
 * for sites it doesn't trust), other Markdown files in the viewer, other files in their editor
 * (at the lines of a `#L12-L20` link), folders in the Explorer.
 */
export async function openLink(
  document: vscode.Uri,
  href: string,
  column: vscode.ViewColumn | undefined,
  openMarkdown: (uri: vscode.Uri, fragment: string | undefined) => Thenable<unknown>,
): Promise<void> {
  if (isExternalLink(href)) {
    await vscode.env.openExternal(vscode.Uri.parse(href));
    return;
  }
  // Other schemes (command:, vscode:) could run things; a document's links don't get to.
  if (hasScheme(href) && !/^file:/i.test(href)) return;
  const target = resolveLink(document, href);
  if (!target) return;
  let type: vscode.FileType;
  try {
    type = (await vscode.workspace.fs.stat(target.uri)).type;
  } catch {
    void vscode.window.showWarningMessage(vscode.l10n.t("Couldn't find {0}", href));
    return;
  }
  if (type & vscode.FileType.Directory) {
    await vscode.commands.executeCommand('revealInExplorer', target.uri);
  } else if (isMarkdown(target.uri) && !lineFragment(target.fragment)) {
    await openMarkdown(target.uri, target.fragment);
  } else {
    const lines = lineFragment(target.fragment);
    await vscode.commands.executeCommand('vscode.open', target.uri, {
      viewColumn: column,
      selection: lines && new vscode.Range(lines[0], 0, lines[1], 0),
    } satisfies vscode.TextDocumentShowOptions);
  }
}

/**
 * The Edit button: the text of the file, at `line`. A text editor already showing it is used;
 * otherwise the viewer is swapped for one, as Reopen Editor With does. A comparison turns into
 * VS Code's text comparison.
 */
export async function editMarkdown(
  document: vscode.Uri,
  comparing: boolean,
  line: number | undefined,
): Promise<void> {
  if (comparing) {
    switchingToText = true;
    try {
      await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
    } finally {
      switchingToText = false;
    }
    return;
  }
  const at = line === undefined ? undefined : new vscode.Range(line, 0, line, 0);
  const shown = vscode.window.visibleTextEditors.find((editor) =>
    sameFile(editor.document.uri, document),
  );
  if (shown) {
    const editor = await vscode.window.showTextDocument(shown.document, shown.viewColumn);
    if (at) reveal(editor, at);
    return;
  }
  await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
  const editor = vscode.window.activeTextEditor;
  if (editor && at && sameFile(editor.document.uri, document)) reveal(editor, at);
}

function reveal(editor: vscode.TextEditor, range: vscode.Range): void {
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
}

/**
 * Open in Nightdocs, from a Markdown file's editor, its comparison or the Explorer. A text
 * comparison turns into the viewer's comparison in place; a file opens beside its text editor,
 * like VS Code's preview, or in place from the Explorer.
 */
export async function openInViewer(resource: unknown): Promise<void> {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const uri = resource instanceof vscode.Uri ? resource : undefined;
  if (
    tab?.input instanceof vscode.TabInputTextDiff &&
    isMarkdown(tab.input.modified) &&
    (!uri || sameFile(uri, tab.input.modified) || sameFile(uri, tab.input.original))
  ) {
    await vscode.commands.executeCommand('reopenActiveEditorWith', MARKDOWN_VIEW_TYPE);
    return;
  }
  const editor = vscode.window.activeTextEditor;
  const target = uri ?? editor?.document.uri;
  if (!target) return;
  const fromEditor = editor !== undefined && sameFile(editor.document.uri, target);
  await vscode.commands.executeCommand(
    'vscode.openWith',
    target,
    MARKDOWN_VIEW_TYPE,
    fromEditor ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } : undefined,
  );
}

/**
 * With `nightdocs.markdown.compareRendered` on, a text comparison of Markdown files that comes
 * into view (from Source Control, the timeline, Compare Selected) is reopened in the viewer.
 */
export function renderComparisons(): vscode.Disposable {
  let shown: string | undefined;
  const check = () => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = tab?.input instanceof vscode.TabInputTextDiff ? tab.input : undefined;
    const key = input && isMarkdown(input.modified) ? comparisonKey(input) : undefined;
    if (key === shown) return;
    shown = key;
    if (!key) return;
    if (switchingToText) keptAsText.add(key);
    if (keptAsText.has(key)) return;
    const enabled = vscode.workspace
      .getConfiguration('nightdocs')
      .get<boolean>('markdown.compareRendered', false);
    if (enabled) void vscode.commands.executeCommand('reopenActiveEditorWith', MARKDOWN_VIEW_TYPE);
  };
  check();
  return vscode.Disposable.from(
    vscode.window.tabGroups.onDidChangeTabs(check),
    vscode.window.tabGroups.onDidChangeTabGroups(check),
  );
}

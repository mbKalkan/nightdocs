import * as vscode from 'vscode';
import { MARKDOWN_EXTENSIONS } from '../shared/formats';
import { comparisonKey, inlineUri, prefersInline, type InlineComparison } from './inlineCompare';
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

/**
 * Finds a tab. Switching how a comparison is shown names the tab it replaces rather than
 * acting on the active editor, which is in whichever window has focus (editors can be in
 * floating windows).
 */
type TabMatch = (tab: vscode.Tab) => boolean;

function findTab(matches: TabMatch): vscode.Tab | undefined {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs).find(matches);
}

/** The tab of a comparison shown inline. */
const isInlineTab =
  (comparison: InlineComparison): TabMatch =>
  (tab) =>
    tab.input instanceof vscode.TabInputCustom &&
    tab.input.uri.toString() === inlineUri(comparison).toString();

/** The tab of VS Code's text comparison of the same versions. */
const isTextComparisonTab =
  (comparison: InlineComparison): TabMatch =>
  (tab) =>
    tab.input instanceof vscode.TabInputTextDiff &&
    comparisonKey(tab.input) === comparisonKey(comparison);

/** The tab of a comparison in the viewer side by side: its two viewers show in `column`. */
export const isSideBySideTab =
  (column: vscode.ViewColumn | undefined, label: string): TabMatch =>
  (tab) =>
    tab.group.viewColumn === column && tab.input === undefined && tab.label === label;

/** Closes the tab `replaced` finds, if it is still open (a preview tab is replaced already). */
async function close(replaced: TabMatch): Promise<void> {
  const tab = findTab(replaced);
  if (tab) await vscode.window.tabGroups.close(tab, true);
}

/** Where a comparison replacing the tab `replaced` finds opens: in its place, kept or not. */
function placeOf(replaced: TabMatch): { column?: vscode.ViewColumn; preview: boolean } {
  const tab = findTab(replaced);
  return { column: tab?.group.viewColumn, preview: tab?.isPreview ?? false };
}

/** Shows a comparison inline, in the place of the tab `replaced` finds. */
export async function showInline(comparison: InlineComparison, replaced: TabMatch): Promise<void> {
  const { column, preview } = placeOf(replaced);
  await vscode.commands.executeCommand(
    'vscode.openWith',
    inlineUri(comparison),
    MARKDOWN_VIEW_TYPE,
    { viewColumn: column, preview } satisfies vscode.TextDocumentShowOptions,
  );
  await close(replaced);
}

/** VS Code's own text editor, and its text comparison. */
const TEXT_EDITOR = 'default';

/**
 * Opens a comparison in `editor`, the viewer or VS Code's text comparison, at `place`, with
 * `line` of the new version in view. Markdown comparisons may be associated with the viewer
 * (workbench.diffEditorAssociations), so vscode.diff alone could open either; this goes through
 * the command behind it, which can name the editor. Its column counts from 0, the API's from 1.
 */
async function openComparison(
  comparison: InlineComparison,
  editor: string,
  { column, preview }: { column?: vscode.ViewColumn; preview: boolean },
  line?: number,
): Promise<void> {
  const { original, modified, label } = comparison;
  const at = line === undefined ? undefined : new vscode.Range(line, 0, line, 0);
  try {
    await vscode.commands.executeCommand(
      '_workbench.diff',
      original,
      modified,
      label || undefined,
      [
        column === undefined ? undefined : column - 1,
        {
          override: editor,
          pinned: !preview,
          selection: at && { startLineNumber: line! + 1, startColumn: 1 },
        },
      ],
    );
  } catch {
    // Without it: VS Code's comparison, reopened in the viewer (it is the active editor now).
    await vscode.commands.executeCommand('vscode.diff', original, modified, label || undefined, {
      viewColumn: column,
      preview,
      selection: at,
    } satisfies vscode.TextDocumentShowOptions);
    if (editor !== TEXT_EDITOR) {
      await vscode.commands.executeCommand('reopenActiveEditorWith', editor);
    }
  }
}

/** Shows a comparison in the viewer side by side, in the place of the tab `replaced` finds. */
export async function showSideBySide(
  comparison: InlineComparison,
  replaced: TabMatch,
): Promise<void> {
  await openComparison(comparison, MARKDOWN_VIEW_TYPE, placeOf(replaced));
  await close(replaced);
}

/**
 * Edit in a comparison: VS Code's text comparison, at `line` of the new version, in the place of
 * the tab `replaced` finds. It stays text for the rest of the session.
 */
export async function showText(
  comparison: InlineComparison,
  replaced: TabMatch,
  line?: number,
): Promise<void> {
  keptAsText.add(comparisonKey(comparison));
  await openComparison(comparison, TEXT_EDITOR, placeOf(replaced), line);
  await close(replaced);
}

export const editInline = (comparison: InlineComparison, line?: number) =>
  showText(comparison, isInlineTab(comparison), line);

/** Shows a text comparison in the viewer: inline or side by side, as last chosen. */
async function renderTextComparison(
  tab: vscode.Tab,
  input: vscode.TabInputTextDiff,
): Promise<void> {
  const comparison = { original: input.original, modified: input.modified, label: tab.label };
  keptAsText.delete(comparisonKey(comparison));
  if (prefersInline()) await showInline(comparison, isTextComparisonTab(comparison));
  else await showSideBySide(comparison, isTextComparisonTab(comparison));
}

/** The text comparison of Markdown files a tab shows, if it does. */
function textComparison(tab: vscode.Tab | undefined): vscode.TabInputTextDiff | undefined {
  return tab?.input instanceof vscode.TabInputTextDiff && isMarkdown(tab.input.modified)
    ? tab.input
    : undefined;
}

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
    // A plain copy: a Node Buffer turns itself into JSON numbers on the way to the webview.
    return { data: new Uint8Array(await vscode.workspace.fs.readFile(target.uri)), mime };
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
 * otherwise the viewer in `column` is swapped for one, as Reopen Editor With does.
 */
export async function editMarkdown(
  document: vscode.Uri,
  line: number | undefined,
  column: vscode.ViewColumn | undefined,
): Promise<void> {
  const at = line === undefined ? undefined : new vscode.Range(line, 0, line, 0);
  const shown = vscode.window.visibleTextEditors.find((editor) =>
    sameFile(editor.document.uri, document),
  );
  if (shown) {
    const editor = await vscode.window.showTextDocument(shown.document, shown.viewColumn);
    if (at) reveal(editor, at);
    return;
  }
  const viewer: TabMatch = (tab) =>
    tab.group.viewColumn === column &&
    tab.input instanceof vscode.TabInputCustom &&
    tab.input.viewType === MARKDOWN_VIEW_TYPE &&
    sameFile(tab.input.uri, document);
  const { preview } = placeOf(viewer);
  // Named, not "the active editor": that can be in another window than the viewer's.
  await vscode.commands.executeCommand('vscode.openWith', document, TEXT_EDITOR, {
    viewColumn: column,
    preview,
    selection: at,
  } satisfies vscode.TextDocumentShowOptions);
  await close(viewer);
  const editor = vscode.window.visibleTextEditors.find(
    (e) => sameFile(e.document.uri, document) && e.viewColumn === column,
  );
  if (editor && at) reveal(editor, at);
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
export async function openInViewer(resource: unknown, selected?: unknown): Promise<void> {
  const uri = resource instanceof vscode.Uri ? resource : undefined;
  // From the Explorer, which passes the files selected along: that file, not a comparison of it.
  const fromExplorer = Array.isArray(selected);
  // The tab the button is on: in the active group, or else in another group (a floating
  // window's group doesn't count as active).
  const { activeTabGroup, all } = vscode.window.tabGroups;
  const groups = uri ? [activeTabGroup, ...all.filter((group) => group !== activeTabGroup)] : [];
  const shown = (uri ? groups : [activeTabGroup])
    .map((group) => group.activeTab)
    .find((tab) => {
      const input = textComparison(tab);
      if (input) return !uri || sameFile(uri, input.modified) || sameFile(uri, input.original);
      return uri && tab?.input instanceof vscode.TabInputText && sameFile(tab.input.uri, uri);
    });
  const input = textComparison(shown);
  if (shown && input && !fromExplorer) {
    await renderTextComparison(shown, input);
    return;
  }
  const editor = vscode.window.activeTextEditor;
  const target = uri ?? editor?.document.uri;
  if (!target) return;
  const fromEditor = editor !== undefined && sameFile(editor.document.uri, target);
  const textTab = !fromExplorer && shown?.input instanceof vscode.TabInputText ? shown : undefined;
  // Beside its text editor, like VS Code's preview; one in another window gets a tab beside it.
  const options: vscode.TextDocumentShowOptions | undefined =
    textTab && textTab.group !== activeTabGroup
      ? { viewColumn: textTab.group.viewColumn }
      : fromEditor || textTab
        ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }
        : undefined;
  await vscode.commands.executeCommand('vscode.openWith', target, MARKDOWN_VIEW_TYPE, options);
}

/**
 * With `nightdocs.markdown.compareRendered` on, a text comparison of Markdown files that comes
 * into view (from Source Control, the timeline, Compare Selected), in any window, is shown in
 * the viewer instead.
 */
export function renderComparisons(): vscode.Disposable {
  let shown = new Set<string>();
  const check = () => {
    const enabled = vscode.workspace
      .getConfiguration('nightdocs')
      .get<boolean>('markdown.compareRendered', false);
    const visible = new Set<string>();
    for (const { activeTab: tab } of vscode.window.tabGroups.all) {
      const input = textComparison(tab);
      if (!tab || !input) continue;
      const key = comparisonKey(input);
      visible.add(key);
      if (enabled && !shown.has(key) && !keptAsText.has(key)) void renderTextComparison(tab, input);
    }
    shown = visible;
  };
  check();
  return vscode.Disposable.from(
    vscode.window.tabGroups.onDidChangeTabs(check),
    vscode.window.tabGroups.onDidChangeTabGroups(check),
  );
}

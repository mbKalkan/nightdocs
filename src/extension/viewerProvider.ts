import * as vscode from 'vscode';
import { detectContainer, formatForPath, isTextFormat, type FormatInfo } from '../shared/formats';
import { composeReference } from '../shared/reference';
import type {
  ColorMode,
  DocumentFormat,
  HostToWebviewMessage,
  ViewerCommand,
  WebviewToHostMessage,
  ZoomAction,
} from '../shared/protocol';
import { DiffPairs, type DiffMember } from './diffPairs';
import { watchFile } from './fileWatcher';
import { readGitBlob } from './gitBlob';
import {
  keepLayoutIn,
  parseInlineUri,
  setPrefersInline,
  type InlineComparison,
} from './inlineCompare';
import {
  editInline,
  editMarkdown,
  MARKDOWN_VIEW_TYPE,
  openInViewer,
  openLink,
  readPicture,
  showInline,
  showSideBySide,
} from './markdown';
import { isExternalLink } from './markdownLinks';
import { openWithDefaultApp } from './openWithDefaultApp';
import { pick } from './quickPick';
import { viewerStrings } from './strings';
import { buildWebviewHtml } from './webviewHtml';

/** Each kind of file remembers whether its navigation pane was left open, as Office does. */
const navigationPaneKey = (format: DocumentFormat) => `nightdocs.navigationPane.${format}`;

/** Typing in a Markdown file's text editor updates its view after this pause. */
const TYPING_DELAY_MS = 250;

const sameFile = (a: vscode.Uri, b: vscode.Uri) => a.toString() === b.toString();

const ONLINE_CONTENT_SETTING = 'nightdocs.markdown.showOnlineContent';

/** Whether the user chose to see pictures from the web in Markdown files without asking. */
const showOnlineContent = () =>
  vscode.workspace.getConfiguration().get<boolean>(ONLINE_CONTENT_SETTING, false);

export class ViewerProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'nightdocs.viewer';

  /** Remembers the last color choice across documents and sessions. */
  private static readonly colorModeKey = 'nightdocs.colorMode';

  private activePanel: { panel: vscode.WebviewPanel; uri: vscode.Uri } | undefined;
  private readonly panels = new Set<{ panel: vscode.WebviewPanel; uri: vscode.Uri }>();
  private readonly diffs = new DiffPairs();
  /** Where to scroll a Markdown file opened from a link to `file.md#heading`. */
  private readonly fragments = new Map<string, string>();

  constructor(
    private readonly extension: vscode.Extension<unknown>,
    private readonly state: vscode.Memento,
  ) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ViewerProvider(context.extension, context.globalState);
    keepLayoutIn(context.globalState);
    const options = {
      webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true },
      supportsMultipleEditorsPerDocument: true,
    };
    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(ViewerProvider.viewType, provider, options),
      // Markdown has its own view type: it is an option next to the text editor, not the default.
      vscode.window.registerCustomEditorProvider(MARKDOWN_VIEW_TYPE, provider, options),
      vscode.commands.registerCommand('nightdocs.openMarkdown', (resource: unknown) =>
        openInViewer(resource),
      ),
      vscode.commands.registerCommand('nightdocs.openInOffice', () =>
        provider.openActiveInOffice(),
      ),
      vscode.commands.registerCommand('nightdocs.zoomIn', () => provider.zoomActive('in')),
      vscode.commands.registerCommand('nightdocs.zoomOut', () => provider.zoomActive('out')),
      vscode.commands.registerCommand('nightdocs.resetZoom', () => provider.zoomActive('reset')),
      vscode.commands.registerCommand('nightdocs.nextSheet', () =>
        provider.sendCommand('nextSheet'),
      ),
      vscode.commands.registerCommand('nightdocs.previousSheet', () =>
        provider.sendCommand('previousSheet'),
      ),
      // One command per format, so each has a title that says what it lists.
      ...['goToSheet', 'goToSlide', 'goToHeading'].map((id) =>
        vscode.commands.registerCommand(`nightdocs.${id}`, () => provider.sendCommand('goTo')),
      ),
      vscode.commands.registerCommand('nightdocs.find', () => provider.sendCommand('find')),
      vscode.commands.registerCommand('nightdocs.toggleInlineView', () =>
        provider.sendCommand('toggleInline'),
      ),
      vscode.commands.registerCommand('nightdocs.toggleNavigation', () =>
        provider.sendCommand('toggleNavigation'),
      ),
      vscode.commands.registerCommand('nightdocs.copyAsMarkdown', () =>
        provider.sendCommand('copyAsMarkdown'),
      ),
      vscode.commands.registerCommand('nightdocs.copyReference', () =>
        provider.sendCommand('copyReference'),
      ),
      vscode.commands.registerCommand('nightdocs.copyReferenceWithText', () =>
        provider.sendCommand('copyReferenceWithText'),
      ),
    );
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    const { uri } = document;
    // A Markdown comparison shown inline is a view of the modified version.
    const inline = parseInlineUri(uri);
    const source = inline?.modified ?? uri;
    const info = formatForPath(source.path);
    if (!info) {
      throw new Error(`Unsupported file type: ${uri.path}`);
    }

    const distWebview = vscode.Uri.joinPath(this.extension.extensionUri, 'dist', 'webview');
    panel.webview.options = { enableScripts: true, localResourceRoots: [distWebview] };
    panel.webview.html = buildWebviewHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'main.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'main.css')).toString(),
      lang: vscode.env.language,
      // Markdown may show pictures from the web, when the user chooses to.
      webPictures: isTextFormat(info.format),
    });

    const post = (message: HostToWebviewMessage) => panel.webview.postMessage(message);
    const load = (reload: boolean) => this.loadInto(uri, info, reload, post, inline);
    const member: DiffMember = { uri, post, ready: false };
    this.diffs.add(member, panel.viewColumn);
    const text = isTextFormat(info.format);

    const subscriptions: vscode.Disposable[] = [
      panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
        switch (message.type) {
          case 'ready':
            this.diffs.ready(member);
            void load(false);
            break;
          case 'summary':
            this.diffs.summary(member, message.summary);
            break;
          case 'scroll':
            this.diffs.relay(member, { type: 'peerScroll', anchor: message.anchor });
            break;
          case 'select':
            this.diffs.relay(member, { type: 'peerSelect', selection: message.selection });
            break;
          case 'zoomed':
            this.diffs.relay(member, { type: 'peerZoom', zoom: message.zoom });
            break;
          case 'showOnline':
            this.diffs.relay(member, { type: 'peerShowOnline' });
            break;
          case 'openInOffice':
            if (inline) void editInline(inline, message.line);
            else if (text) void editMarkdown(uri, member.side !== undefined, message.line);
            else void this.openInOffice(uri, info);
            break;
          case 'setInline':
            setPrefersInline(message.inline);
            if (inline && !message.inline) void showSideBySide(inline);
            else if (!inline && message.inline) this.showInline(member, panel);
            break;
          case 'resource':
            void readPicture(source, message.href).then((picture) =>
              post({ type: 'resource', id: message.id, ...picture }),
            );
            break;
          case 'openLink':
            // Office documents follow only web and mail links; Markdown also links to files.
            if (!text) {
              if (isExternalLink(message.href)) {
                void vscode.env.openExternal(vscode.Uri.parse(message.href));
              }
              break;
            }
            void openLink(source, message.href, panel.viewColumn, (target, fragment) => {
              if (fragment) this.fragments.set(target.toString(), fragment);
              return vscode.commands.executeCommand('vscode.openWith', target, MARKDOWN_VIEW_TYPE, {
                viewColumn: panel.viewColumn,
              });
            });
            break;
          case 'copyText':
            void vscode.env.clipboard
              .writeText(message.text)
              .then(() => vscode.window.setStatusBarMessage(vscode.l10n.t('Copied'), 3000));
            break;
          case 'setColorMode':
            void this.state.update(ViewerProvider.colorModeKey, message.mode);
            break;
          case 'setNavigationPane':
            void this.state.update(navigationPaneKey(info.format), message.open);
            break;
          case 'pick':
            void pick(message.placeholder, message.items).then((index) =>
              post({ type: 'picked', index }),
            );
            break;
          case 'copy':
            // The webview may not have focus (the command palette does), so the host copies.
            void vscode.env.clipboard
              .writeText(message.text)
              .then(() =>
                vscode.window.setStatusBarMessage(
                  message.rows === 1
                    ? vscode.l10n.t('Copied 1 row as a Markdown table')
                    : vscode.l10n.t('Copied {0} rows as a Markdown table', message.rows),
                  3000,
                ),
              );
            break;
          case 'reference':
            void vscode.env.clipboard
              .writeText(composeReference(referencePath(source), message.location, message.text))
              .then(() =>
                vscode.window.setStatusBarMessage(
                  message.text
                    ? vscode.l10n.t('Copied reference with text')
                    : vscode.l10n.t('Copied reference'),
                  3000,
                ),
              );
            break;
        }
      }),
      ...(inline ? [inline.modified, inline.original] : [uri]).map((file) =>
        watchFile(file, () => void load(true)),
      ),
      panel.onDidChangeViewState(() => this.trackActive(panel, uri)),
    ];
    if (text) {
      const files = inline ? [inline.modified, inline.original] : [uri];
      subscriptions.push(...this.followTextEditor(files, panel, member, () => load(true)));
    }
    this.trackActive(panel, uri);
    const entry = { panel, uri };
    this.panels.add(entry);

    panel.onDidDispose(() => {
      this.panels.delete(entry);
      subscriptions.forEach((s) => s.dispose());
      this.diffs.remove(member);
      if (this.activePanel?.panel === panel) {
        this.activePanel = undefined;
        this.updateContext();
      }
    });
  }

  /** Shows the side by side comparison `member` is a side of inline, in its place. */
  private showInline(member: DiffMember, panel: vscode.WebviewPanel): void {
    const { peer, side } = member;
    if (!peer || !side) return;
    const [original, modified] = side === 'original' ? [member, peer] : [peer, member];
    const column = panel.viewColumn;
    const label =
      vscode.window.tabGroups.all.find((group) => group.viewColumn === column)?.activeTab?.label ??
      '';
    void showInline(
      { original: original.uri, modified: modified.uri, label },
      (tab) => tab.group.viewColumn === column && tab.input === undefined && tab.label === label,
    );
  }

  /**
   * Keeps a Markdown view in step with the text editors of its files: it shows unsaved changes
   * as they are typed, and scrolls along when the editor beside it scrolls. It also shows
   * pictures from the web as soon as the setting for them is turned on.
   */
  private followTextEditor(
    files: vscode.Uri[],
    panel: vscode.WebviewPanel,
    member: DiffMember,
    reload: () => unknown,
  ): vscode.Disposable[] {
    let typing: ReturnType<typeof setTimeout> | undefined;
    const followed = (uri: vscode.Uri) => files.some((file) => sameFile(file, uri));
    return [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!followed(event.document.uri) || event.contentChanges.length === 0) return;
        clearTimeout(typing);
        typing = setTimeout(reload, TYPING_DELAY_MS);
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges(({ textEditor, visibleRanges }) => {
        // A comparison has its own place; side by side, it scrolls with its other side.
        const uri = textEditor.document.uri;
        if (!panel.visible || member.side || files.length > 1 || !followed(uri)) return;
        const top = visibleRanges[0]?.start.line;
        if (top !== undefined) void panel.webview.postMessage({ type: 'revealLine', line: top });
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(ONLINE_CONTENT_SETTING)) reload();
      }),
      { dispose: () => clearTimeout(typing) },
    ];
  }

  private trackActive(panel: vscode.WebviewPanel, uri: vscode.Uri): void {
    if (panel.active) {
      this.activePanel = { panel, uri };
    } else if (this.activePanel?.panel === panel) {
      this.activePanel = undefined;
    }
    this.updateContext();
  }

  /** Lets keybindings target one format, e.g. our own find for spreadsheets. */
  private updateContext(): void {
    const format = this.activePanel ? formatForPath(this.activePanel.uri.path)?.format : undefined;
    void vscode.commands.executeCommand('setContext', 'nightdocs.activeFormat', format ?? '');
  }

  private async loadInto(
    uri: vscode.Uri,
    info: FormatInfo,
    reload: boolean,
    post: (message: HostToWebviewMessage) => Thenable<boolean>,
    inline?: InlineComparison,
  ): Promise<void> {
    const text = isTextFormat(info.format);
    const source = inline?.modified ?? uri;
    const name = source.path.slice(source.path.lastIndexOf('/') + 1);
    const common = {
      fileName: inline?.label || name,
      format: info.format,
      // Markdown's text editor is always there to switch to, even on the web.
      canOpenInOffice: text || this.canOpenInOffice(uri),
      strings: viewerStrings(info),
    };
    let data: Uint8Array;
    let original: Uint8Array | undefined;
    try {
      data = await readVersion(source, text);
      if (inline) original = await readVersion(inline.original, text);
    } catch {
      // A save in progress can briefly remove the file; keep showing the last good render.
      if (!reload) {
        await post({ type: 'readError', ...common });
      }
      return;
    }
    const fragment = reload || inline ? undefined : this.fragments.get(uri.toString());
    this.fragments.delete(uri.toString());
    // Opened beside its text editor, a Markdown view starts where the editor is.
    const line = text && !reload && !inline ? this.editorTop(uri) : undefined;
    // A plain copy: a Node Buffer turns itself into JSON numbers on the way to the webview.
    await post({
      type: 'load',
      data: new Uint8Array(data),
      reload,
      colorMode: this.state.get<ColorMode>(ViewerProvider.colorModeKey, 'dark'),
      navigationPane: this.state.get<boolean>(navigationPaneKey(info.format), false),
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      fragment,
      line,
      onlineContent: text && showOnlineContent(),
      original: original && new Uint8Array(original),
      ...common,
    });
  }

  /** The first line a visible text editor of `uri` shows, unless it is at the top. */
  private editorTop(uri: vscode.Uri): number | undefined {
    const editor = vscode.window.visibleTextEditors.find((e) => sameFile(e.document.uri, uri));
    return editor?.visibleRanges[0]?.start.line || undefined;
  }

  /** Opening a desktop app only makes sense for local files on the machine running the UI. */
  private canOpenInOffice(uri: vscode.Uri): boolean {
    return (
      uri.scheme === 'file' &&
      vscode.env.uiKind === vscode.UIKind.Desktop &&
      (vscode.env.remoteName === undefined ||
        this.extension.extensionKind === vscode.ExtensionKind.UI)
    );
  }

  private async openInOffice(uri: vscode.Uri, info: FormatInfo): Promise<void> {
    if (!this.canOpenInOffice(uri)) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Opening in {0} is only available for local files.', info.appName),
      );
      return;
    }
    try {
      await openWithDefaultApp(uri.fsPath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        vscode.l10n.t("Couldn't open the file in {0}: {1}", info.appName, reason),
      );
    }
  }

  private openActiveInOffice(): Promise<void> | undefined {
    const active = this.activePanel;
    const info = active && formatForPath(active.uri.path);
    return active && info ? this.openInOffice(active.uri, info) : undefined;
  }

  /**
   * The view a command goes to: the one with focus, or else one showing in the active editor
   * group (a side by side comparison just opened has no side with focus).
   */
  private commandTarget(): { panel: vscode.WebviewPanel; uri: vscode.Uri } | undefined {
    if (this.activePanel) return this.activePanel;
    const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
    return [...this.panels].find(({ panel }) => panel.visible && panel.viewColumn === column);
  }

  private sendCommand(command: ViewerCommand): void {
    void this.commandTarget()?.panel.webview.postMessage({
      type: 'command',
      command,
    } satisfies HostToWebviewMessage);
  }

  private zoomActive(action: ZoomAction): void {
    void this.commandTarget()?.panel.webview.postMessage({
      type: 'zoom',
      action,
    } satisfies HostToWebviewMessage);
  }
}

/**
 * Reads a version of a file. An open text editor may have unsaved changes; that is what it shows.
 * A version from Git can come back converted to text; Office files are never text.
 */
async function readVersion(uri: vscode.Uri, text: boolean): Promise<Uint8Array> {
  const open = text
    ? vscode.workspace.textDocuments.find((document) => sameFile(document.uri, uri))
    : undefined;
  if (open) return new TextEncoder().encode(open.getText());
  const data = await vscode.workspace.fs.readFile(uri);
  if (!text && uri.scheme === 'git' && detectContainer(data) === 'unknown') {
    return (await readGitBlob(uri)) ?? data;
  }
  return data;
}

/**
 * How a copied reference names the file: relative to its workspace folder, so that an assistant
 * working in the workspace can find it; versions from Git and other virtual files by name only.
 */
function referencePath(uri: vscode.Uri): string {
  if (uri.scheme === 'file') return vscode.workspace.asRelativePath(uri, false);
  return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}

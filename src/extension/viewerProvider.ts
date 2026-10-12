import * as vscode from 'vscode';
import { formatForPath, type FormatInfo } from '../shared/formats';
import type { HostToWebviewMessage, WebviewToHostMessage, ZoomAction } from '../shared/protocol';
import { watchFile } from './fileWatcher';
import { openWithDefaultApp } from './openWithDefaultApp';
import { viewerStrings } from './strings';
import { buildWebviewHtml } from './webviewHtml';

export class ViewerProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'nightdocs.viewer';

  private activePanel: { panel: vscode.WebviewPanel; uri: vscode.Uri } | undefined;

  constructor(private readonly extension: vscode.Extension<unknown>) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ViewerProvider(context.extension);
    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(ViewerProvider.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true },
        supportsMultipleEditorsPerDocument: true,
      }),
      vscode.commands.registerCommand('nightdocs.openInOffice', () =>
        provider.openActiveInOffice(),
      ),
      vscode.commands.registerCommand('nightdocs.zoomIn', () => provider.zoomActive('in')),
      vscode.commands.registerCommand('nightdocs.zoomOut', () => provider.zoomActive('out')),
      vscode.commands.registerCommand('nightdocs.resetZoom', () => provider.zoomActive('reset')),
    );
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    const { uri } = document;
    const info = formatForPath(uri.path);
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
    });

    const post = (message: HostToWebviewMessage) => panel.webview.postMessage(message);
    const load = (reload: boolean) => this.loadInto(uri, info, reload, post);

    const subscriptions: vscode.Disposable[] = [
      panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
        switch (message.type) {
          case 'ready':
            void load(false);
            break;
          case 'openInOffice':
            void this.openInOffice(uri, info);
            break;
        }
      }),
      watchFile(uri, () => void load(true)),
      panel.onDidChangeViewState(() => this.trackActive(panel, uri)),
    ];
    this.trackActive(panel, uri);

    panel.onDidDispose(() => {
      subscriptions.forEach((s) => s.dispose());
      if (this.activePanel?.panel === panel) {
        this.activePanel = undefined;
      }
    });
  }

  private trackActive(panel: vscode.WebviewPanel, uri: vscode.Uri): void {
    if (panel.active) {
      this.activePanel = { panel, uri };
    } else if (this.activePanel?.panel === panel) {
      this.activePanel = undefined;
    }
  }

  private async loadInto(
    uri: vscode.Uri,
    info: FormatInfo,
    reload: boolean,
    post: (message: HostToWebviewMessage) => Thenable<boolean>,
  ): Promise<void> {
    const common = {
      fileName: uri.path.slice(uri.path.lastIndexOf('/') + 1),
      format: info.format,
      canOpenInOffice: this.canOpenInOffice(uri),
      strings: viewerStrings(info.appName),
    };
    let data: Uint8Array;
    try {
      data = await vscode.workspace.fs.readFile(uri);
    } catch {
      // A save in progress can briefly remove the file; keep showing the last good render.
      if (!reload) {
        await post({ type: 'readError', ...common });
      }
      return;
    }
    // Copy into a standalone buffer: small Node buffers can be views into a shared pool.
    await post({ type: 'load', data: new Uint8Array(data), reload, ...common });
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

  private zoomActive(action: ZoomAction): void {
    void this.activePanel?.panel.webview.postMessage({
      type: 'zoom',
      action,
    } satisfies HostToWebviewMessage);
  }
}

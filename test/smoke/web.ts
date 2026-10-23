// Runs inside VS Code for the Web, in the web worker extension host (see scripts/smoke-web.mjs).
import * as vscode from 'vscode';

const EXTENSION_ID = 'MBKDevStudio.nightdocs';
const VIEW_TYPE = 'nightdocs.viewer';

function ok(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The fixtures folder is served on a virtual file system, as a repository is on github.dev. */
function fixture(name: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  ok(folder, 'no workspace folder is open');
  return vscode.Uri.joinPath(folder.uri, name);
}

async function opensInViewer(name: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.open', fixture(name));
  const input = await waitFor(() => {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputCustom && tab.input.uri.path.endsWith(name)) {
          return tab.input;
        }
      }
    }
    return undefined;
  });
  ok(input.viewType === VIEW_TYPE, `${name} opened in ${input.viewType}`);
}

const tests: Record<string, () => Promise<void>> = {
  async 'activates in the web extension host'() {
    ok(vscode.env.uiKind === vscode.UIKind.Web, 'not running as VS Code for the Web');
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    ok(extension, `${EXTENSION_ID} is not installed`);
    await extension.activate();
    ok(extension.isActive, `${EXTENSION_ID} did not activate`);
  },

  async 'opens Word, Excel and PowerPoint files from a virtual file system'() {
    await opensInViewer('sample.docx');
    await opensInViewer('sample.xlsx');
    await opensInViewer('sample.pptx');
  },

  async 'opens Markdown in its viewer when asked'() {
    await vscode.commands.executeCommand(
      'vscode.openWith',
      fixture('markdown/sample.md'),
      'nightdocs.markdown',
    );
    await waitFor(() =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find(
          (tab) =>
            tab.input instanceof vscode.TabInputCustom &&
            tab.input.viewType === 'nightdocs.markdown',
        ),
    );
  },

  async 'registers its commands'() {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['openInOffice', 'zoomIn', 'goToSheet', 'goToSlide', 'goToHeading']) {
      ok(commands.includes(`nightdocs.${id}`), `missing nightdocs.${id}`);
    }
  },

  async 'accepts viewer commands while a file is open'() {
    await vscode.commands.executeCommand('nightdocs.zoomIn');
    await vscode.commands.executeCommand('nightdocs.resetZoom');
  },
};

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const [name, test] of Object.entries(tests)) {
    try {
      await test();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.log(`  ✗ ${name}`);
      failures.push(`${name}: ${error instanceof Error ? error.stack : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} web smoke test(s) failed:\n${failures.join('\n')}`);
  }
}

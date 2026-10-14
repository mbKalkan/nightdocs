// Runs inside a real VS Code instance (see scripts/smoke.mjs).
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readGitBlob } from '../../src/extension/gitBlob';

const EXTENSION_ID = 'MBKDevStudio.nightdocs';
const VIEW_TYPE = 'nightdocs.viewer';
const FIXTURES = path.resolve(__dirname, '../../test/fixtures');

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for condition. ${describeEditors()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** What the workbench shows, for the message of a failed wait. */
function describeEditors(): string {
  const tabs = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.map((tab) => {
      const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
      const kind = input?.constructor?.name ?? typeof input;
      const uri = input?.uri?.toString() ?? '';
      return `${tab.isActive ? '*' : ''}${tab.label} [${kind}${input?.viewType ? ` ${input.viewType}` : ''}] ${uri}`;
    }),
  );
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  return `Tabs: ${tabs.length ? tabs.join('; ') : 'none'}. Text editors: ${
    vscode.window.visibleTextEditors.map((e) => e.document.uri.toString()).join(', ') || 'none'
  }. Extension ${extension ? (extension.isActive ? 'active' : 'inactive') : 'missing'}.`;
}

interface Repository {
  git(...args: string[]): Buffer;
  /** Writes a file in the repository and returns its path. */
  write(name: string, content: string): string;
  gitDir: string;
}

/**
 * Commits a `report.docx` that `setup` writes into a new repository, then runs `check` with
 * the URI VS Code's Git extension uses for the committed version.
 */
async function withRepository(
  setup: (repository: Repository) => Promise<void>,
  check: (head: vscode.Uri) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'nightdocs-git-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    const write = (name: string, content: string) => {
      writeFileSync(path.join(root, name), content);
      return path.join(root, name);
    };
    await setup({ git, write, gitDir: path.join(root, '.git') });
    git('add', '.');
    git('commit', '-q', '-m', 'Add a report');

    const api = (await vscode.extensions.getExtension('vscode.git')!.activate()).getAPI(1);
    await api.openRepository(vscode.Uri.file(root));
    await check(api.toGitUri(vscode.Uri.file(path.join(root, 'report.docx')), 'HEAD'));
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // The Git extension keeps watching the repository; the temp folder can stay.
    }
  }
}

/** VS Code's own read gets something else; Nightdocs's gets the document, a ZIP archive. */
async function assertReadsDocument(head: vscode.Uri): Promise<void> {
  const isZip = (bytes: Uint8Array | undefined) =>
    Buffer.from(bytes ?? [])
      .subarray(0, 2)
      .toString() === 'PK';
  assert.equal(isZip(await vscode.workspace.fs.readFile(head)), false);
  assert.equal(isZip(await readGitBlob(head)), true);
}

const tests: Record<string, () => Promise<void>> = {
  async 'opens .docx files in the viewer by default'() {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(`${FIXTURES}/sample.docx`));
    // Right after startup the workbench may still be settling, so look across all groups.
    const input = await waitFor(() => {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputCustom && tab.input.uri.path.endsWith('.docx')) {
            return tab.input;
          }
        }
      }
      return undefined;
    });
    assert.equal(input.viewType, VIEW_TYPE);
    assert.ok(vscode.extensions.getExtension(EXTENSION_ID)?.isActive);
  },

  async 'opens .xlsx files in the viewer by default'() {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(`${FIXTURES}/sample.xlsx`));
    const input = await waitFor(() => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      return tab?.input instanceof vscode.TabInputCustom && tab.input.uri.path.endsWith('.xlsx')
        ? tab.input
        : undefined;
    });
    assert.equal(input.viewType, VIEW_TYPE);
    await vscode.commands.executeCommand('nightdocs.nextSheet');
    await vscode.commands.executeCommand('nightdocs.previousSheet');
  },

  async 'opens .pptx files in the viewer by default'() {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(`${FIXTURES}/sample.pptx`));
    const input = await waitFor(() => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      return tab?.input instanceof vscode.TabInputCustom && tab.input.uri.path.endsWith('.pptx')
        ? tab.input
        : undefined;
    });
    assert.equal(input.viewType, VIEW_TYPE);
  },

  async 'compares two versions side by side in a tab it can recognize'() {
    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(`${FIXTURES}/sample.docx`),
      vscode.Uri.file(`${FIXTURES}/sample-revised.docx`),
    );
    const tab = await waitFor(() => {
      const active = vscode.window.tabGroups.activeTabGroup.activeTab;
      return active?.label.includes(' ↔ ') ? active : undefined;
    });
    // The viewers of a comparison find each other by this: a tab with no input the API exposes.
    assert.equal(tab.input, undefined);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  },

  async 'reads Word files from Git even where git converts them to text'() {
    // Git for Windows sets `*.docx diff=astextplain`, and VS Code reads versions with
    // `git show --textconv`, so the old side of a comparison came back as plain text.
    await withRepository(async ({ git, write }) => {
      git('config', 'diff.astextplain.textconv', 'echo converted');
      write('.gitattributes', '*.docx diff=astextplain\n');
      copyFileSync(`${FIXTURES}/sample.docx`, write('report.docx', ''));
    }, assertReadsDocument);
  },

  async 'reads Word files kept in Git LFS'() {
    await withRepository(async ({ write, gitDir }) => {
      const bytes = readFileSync(`${FIXTURES}/sample.docx`);
      const oid = createHash('sha256').update(bytes).digest('hex');
      write(
        'report.docx',
        `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}\n`,
      );
      const store = path.join(gitDir, 'lfs', 'objects', oid.slice(0, 2), oid.slice(2, 4));
      mkdirSync(store, { recursive: true });
      writeFileSync(path.join(store, oid), bytes);
    }, assertReadsDocument);
  },

  async 'registers its commands'() {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'openInOffice',
      'zoomIn',
      'zoomOut',
      'resetZoom',
      'nextSheet',
      'previousSheet',
      'goToSheet',
      'goToSlide',
      'goToHeading',
      'toggleNavigation',
      'copyAsMarkdown',
    ]) {
      assert.ok(commands.includes(`nightdocs.${id}`), `missing nightdocs.${id}`);
    }
  },

  async 'accepts zoom commands while the viewer is active'() {
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
    throw new Error(`${failures.length} smoke test(s) failed:\n${failures.join('\n')}`);
  }
}

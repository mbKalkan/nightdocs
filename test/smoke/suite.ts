// Runs inside a real VS Code instance (see scripts/smoke.mjs).
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readGitBlob } from '../../src/extension/gitBlob';
import { readPicture } from '../../src/extension/markdown';

const EXTENSION_ID = 'MBKDevStudio.nightdocs';
const VIEW_TYPE = 'nightdocs.viewer';
const MARKDOWN_VIEW_TYPE = 'nightdocs.markdown';
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

async function openTab(uri: vscode.Uri, find: () => vscode.Tab | undefined): Promise<vscode.Tab> {
  await vscode.commands.executeCommand('vscode.open', uri);
  return waitFor(find);
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
    const uri = vscode.Uri.file(`${FIXTURES}/sample.docx`);
    const findTab = () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => (tab.input as { uri?: vscode.Uri } | undefined)?.uri?.path === uri.path);
    // Right after startup the workbench can open the file before it has registered the
    // extension's editors, in a plain tab with the extension still inactive (seen on CI).
    // A user opening it a moment later gets the viewer, so close that tab and open again.
    let tab = await openTab(uri, findTab);
    for (let retry = 1; !(tab.input instanceof vscode.TabInputCustom); retry++) {
      if (retry > 5) {
        throw new Error(`sample.docx never opened in the viewer. ${describeEditors()}`);
      }
      console.log(
        `    sample.docx opened outside the viewer; retry ${retry}. ${describeEditors()}`,
      );
      await vscode.window.tabGroups.close(tab);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      tab = await openTab(uri, findTab);
    }
    const input = tab.input;
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

  async 'keeps the text editor as the default for Markdown'() {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const uri = vscode.Uri.file(`${FIXTURES}/markdown/sample.md`);
    await vscode.commands.executeCommand('vscode.open', uri);
    const tab = await waitFor(() => {
      const active = vscode.window.tabGroups.activeTabGroup.activeTab;
      return active?.label === 'sample.md' ? active : undefined;
    });
    assert.ok(tab.input instanceof vscode.TabInputText, describeEditors());
  },

  async 'opens Markdown in the viewer beside its text editor'() {
    // The text editor of sample.md is active, as after the test before.
    await vscode.commands.executeCommand('nightdocs.openMarkdown');
    const input = await waitFor(() =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .map((tab) => tab.input)
        .find(
          (input): input is vscode.TabInputCustom =>
            input instanceof vscode.TabInputCustom && input.viewType === MARKDOWN_VIEW_TYPE,
        ),
    );
    assert.ok(input.uri.path.endsWith('/markdown/sample.md'));
    const group = vscode.window.tabGroups.all.find((g) => g.tabs.some((t) => t.input === input));
    assert.equal(group?.viewColumn, vscode.ViewColumn.Two, 'opened beside the text editor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  },

  async 'turns a text comparison of Markdown into the viewer comparison'() {
    const original = vscode.Uri.file(`${FIXTURES}/markdown/sample.md`);
    const modified = vscode.Uri.file(`${FIXTURES}/markdown/sample-revised.md`);
    // Git titles its comparisons this way; the viewers pair up without the usual "a ↔ b".
    await vscode.commands.executeCommand(
      'vscode.diff',
      original,
      modified,
      'sample.md (Working Tree)',
    );
    await waitFor(() =>
      vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff
        ? true
        : undefined,
    );
    await vscode.commands.executeCommand('nightdocs.openMarkdown');
    const tab = await waitFor(() => {
      const active = vscode.window.tabGroups.activeTabGroup.activeTab;
      return active && active.input === undefined ? active : undefined;
    });
    assert.equal(tab.label, 'sample.md (Working Tree)');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  },

  async 'shows Markdown comparisons rendered when that is turned on'() {
    const settings = vscode.workspace.getConfiguration('nightdocs');
    await settings.update('markdown.compareRendered', true, vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(`${FIXTURES}/markdown/sample.md`),
        vscode.Uri.file(`${FIXTURES}/markdown/sample-revised.md`),
      );
      const tab = await waitFor(() => {
        const active = vscode.window.tabGroups.activeTabGroup.activeTab;
        return active && active.input === undefined ? active : undefined;
      });
      assert.ok(tab.label.includes(' ↔ '), describeEditors());
    } finally {
      await settings.update(
        'markdown.compareRendered',
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  },

  async 'shows a Markdown comparison inline, and side by side again'() {
    const label = 'sample.md (Working Tree)';
    const openTextComparison = async () => {
      await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(`${FIXTURES}/markdown/sample.md`),
        vscode.Uri.file(`${FIXTURES}/markdown/sample-revised.md`),
        label,
      );
      await waitFor(() =>
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff
          ? true
          : undefined,
      );
    };
    const active = () => vscode.window.tabGroups.activeTabGroup.activeTab;
    const sideBySide = () => {
      const tab = active();
      return tab && tab.input === undefined && tab.label === label ? tab : undefined;
    };
    const inline = () => {
      const input = active()?.input;
      return input instanceof vscode.TabInputCustom && input.uri.scheme === 'nightdocs-compare'
        ? input
        : undefined;
    };
    // The toggle works once the comparison is on screen; ask again until it is.
    const toggleUntil = async <T>(shown: () => T | undefined): Promise<T> => {
      let asked = 0;
      return waitFor(() => {
        const result = shown();
        if (result === undefined && asked++ % 10 === 0) {
          void vscode.commands.executeCommand('nightdocs.toggleInlineView');
        }
        return result;
      });
    };
    const tabCount = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs).length;

    try {
      await openTextComparison();
      await vscode.commands.executeCommand('nightdocs.openMarkdown');
      await waitFor(sideBySide);
      // Inline replaces the side by side comparison, in the same place.
      const input = await toggleUntil(inline);
      assert.equal(input.viewType, MARKDOWN_VIEW_TYPE);
      assert.ok(input.uri.path.endsWith('/markdown/sample-revised.md'));
      assert.ok(input.uri.query.includes('sample.md'), input.uri.query);
      assert.equal(tabCount(), 1, describeEditors());

      // The choice holds: the next comparison opens inline.
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await openTextComparison();
      await vscode.commands.executeCommand('nightdocs.openMarkdown');
      await waitFor(inline);
      assert.equal(tabCount(), 1, describeEditors());

      // And back to side by side, with the comparison's own title.
      await toggleUntil(sideBySide);
      assert.equal(tabCount(), 1, describeEditors());
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  },

  async 'hands pictures next to a Markdown file to the view as bytes of their own'() {
    const document = vscode.Uri.file(`${FIXTURES}/markdown/sample.md`);
    const picture = await readPicture(document, 'images/flow.svg');
    assert.ok(picture, 'the picture was not read');
    assert.equal(picture.mime, 'image/svg+xml');
    // VS Code sends webview messages as JSON and passes byte arrays alongside, but a Node
    // Buffer's toJSON runs first: the picture would arrive as {type: 'Buffer', data: [...]}.
    const sent = JSON.stringify({ data: picture.data }, (_key, value: unknown) =>
      ArrayBuffer.isView(value) ? 'bytes' : value,
    );
    assert.equal(sent, '{"data":"bytes"}');
    assert.ok(Buffer.from(picture.data).toString('utf8').startsWith('<svg'));
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
      'toggleInlineView',
      'toggleNavigation',
      'copyAsMarkdown',
      'copyReference',
      'copyReferenceWithText',
      'openMarkdown',
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

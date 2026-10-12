// Runs inside a real VS Code instance (see scripts/smoke.mjs).
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';

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
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const tests: Record<string, () => Promise<void>> = {
  async 'opens .docx files in the viewer by default'() {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(`${FIXTURES}/sample.docx`));
    const input = await waitFor(() => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      return tab?.input instanceof vscode.TabInputCustom ? tab.input : undefined;
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

  async 'registers its commands'() {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'openInOffice',
      'zoomIn',
      'zoomOut',
      'resetZoom',
      'nextSheet',
      'previousSheet',
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

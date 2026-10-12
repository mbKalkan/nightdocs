// Builds the smoke test suite and runs it inside a downloaded copy of VS Code.
import { resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';
import * as esbuild from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const suite = resolve(root, 'out/smoke/suite.js');

await esbuild.build({
  entryPoints: [resolve(root, 'test/smoke/suite.ts')],
  outfile: suite,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  logLevel: 'warning',
});

// When launched from a terminal inside VS Code this is set and would make Code.exe behave as Node.
delete process.env.ELECTRON_RUN_AS_NODE;

await runTests({
  version: process.env.VSCODE_VERSION ?? 'stable',
  extensionDevelopmentPath: root,
  extensionTestsPath: suite,
  launchArgs: [resolve(root, 'test/fixtures'), '--disable-extensions', '--skip-welcome'],
});

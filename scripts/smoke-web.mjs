// Builds the web smoke suite and runs it inside VS Code for the Web, headless in Chromium.
import { resolve } from 'node:path';
import { runTests } from '@vscode/test-web';
import * as esbuild from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const suite = resolve(root, 'out/smoke/web.js');

await esbuild.build({
  entryPoints: [resolve(root, 'test/smoke/web.ts')],
  outfile: suite,
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'chrome120',
  external: ['vscode'],
  logLevel: 'warning',
});

await runTests({
  browserType: 'chromium',
  quality: 'stable',
  headless: true,
  extensionDevelopmentPath: root,
  extensionTestsPath: suite,
  // Served as a virtual file system, the way github.dev serves a repository.
  folderPath: resolve(root, 'test/fixtures'),
  testRunnerDataDir: resolve(root, '.vscode-test-web'),
});

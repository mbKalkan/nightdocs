// Bundles the extension host (Node, CommonJS) and the webview (browser, ESM with lazy chunks).
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
  legalComments: 'linked',
};

/** @type {import('esbuild').BuildOptions} */
const extension = {
  ...shared,
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
};

/**
 * Workers can't be loaded from the extension's resource URLs (different origin), so worker
 * bundles are embedded as strings and started from blob URLs. Import as `worker-source:<name>`.
 * @type {import('esbuild').Plugin}
 */
const workerSource = {
  name: 'worker-source',
  setup(build) {
    build.onResolve({ filter: /^worker-source:/ }, (args) => ({
      path: args.path.slice('worker-source:'.length),
      namespace: 'worker-source',
    }));
    build.onLoad({ filter: /.*/, namespace: 'worker-source' }, async (args) => {
      const entry = `src/webview/${args.path}/worker.ts`;
      const result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        metafile: true,
        format: 'iife',
        platform: 'browser',
        target: 'chrome120',
        minify: production,
        legalComments: 'none',
      });
      return {
        contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
        loader: 'js',
        watchFiles: Object.keys(result.metafile.inputs).map((file) => resolve(file)),
      };
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const webview = {
  ...shared,
  entryPoints: ['src/webview/main.ts'],
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'esm',
  splitting: true,
  target: 'chrome120',
  chunkNames: 'chunks/[name]-[hash]',
  plugins: [workerSource],
};

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  rmSync('dist', { recursive: true, force: true });
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}

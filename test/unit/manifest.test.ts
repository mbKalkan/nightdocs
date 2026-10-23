import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_EXTENSIONS,
  OFFICE_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
} from '../../src/shared/formats';

const readJson = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

const manifest = readJson('package.json') as {
  main: string;
  browser: string;
  engines: { vscode: string };
  contributes: {
    customEditors: {
      viewType: string;
      priority: string;
      selector: { filenamePattern: string }[];
    }[];
    languages: { extensions: string[] }[];
  };
  keywords: string[];
  devDependencies: Record<string, string>;
  icon: string;
  files: string[];
};

describe('extension manifest', () => {
  it('targets the same VS Code API version as @types/vscode', () => {
    const engine = manifest.engines.vscode.replace(/^\^/, '');
    const types = manifest.devDependencies['@types/vscode'].replace(/^[\^~]/, '');
    expect(types).toBe(engine);
  });

  it('ships a web bundle next to the Node one, so it runs on vscode.dev', () => {
    expect(manifest.main).toBe('./dist/extension.js');
    expect(manifest.browser).toBe('./dist/extension.web.js');
    // Both bundles come from the same entry point; only the Node-bound modules are swapped.
    const build = readFileSync('scripts/build.mjs', 'utf8');
    expect(build).toContain("outfile: 'dist/extension.web.js'");
    expect(build).toContain("platform: 'browser'");
  });

  it('opens exactly the file types the viewer can render', () => {
    const patterns = manifest.contributes.customEditors.flatMap((editor) =>
      editor.selector.map((selector) => selector.filenamePattern),
    );
    expect(patterns.sort()).toEqual(SUPPORTED_EXTENSIONS.map((ext) => `*${ext}`).sort());
  });

  it('declares the Office file types as languages, so the Marketplace lists it for them', () => {
    const extensions = manifest.contributes.languages.flatMap((language) => language.extensions);
    // VS Code itself declares Markdown.
    expect(extensions.sort()).toEqual([...OFFICE_EXTENSIONS].sort());
  });

  it('opens Office files by default and Markdown only when asked', () => {
    const editor = (viewType: string) =>
      manifest.contributes.customEditors.find((e) => e.viewType === viewType)!;
    const patterns = (viewType: string) =>
      editor(viewType)
        .selector.map((s) => s.filenamePattern)
        .sort();
    expect(editor('nightdocs.viewer').priority).toBe('default');
    expect(patterns('nightdocs.viewer')).toEqual(OFFICE_EXTENSIONS.map((ext) => `*${ext}`).sort());
    // People edit Markdown; the text editor stays its default.
    expect(editor('nightdocs.markdown').priority).toBe('option');
    expect(patterns('nightdocs.markdown')).toEqual(
      MARKDOWN_EXTENSIONS.map((ext) => `*${ext}`).sort(),
    );
  });

  it('stays within the Marketplace limit of 30 keywords', () => {
    expect(manifest.keywords.length).toBeLessThanOrEqual(30);
    expect(new Set(manifest.keywords).size).toBe(manifest.keywords.length);
  });

  it('defines every %placeholder% in each package.nls file', () => {
    const placeholders = [...JSON.stringify(manifest).matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]);
    for (const file of ['package.nls.json', 'package.nls.tr.json']) {
      const nls = readJson(file);
      for (const key of placeholders) {
        expect(nls, `${file} is missing "${key}"`).toHaveProperty([key]);
      }
    }
  });

  it('ships a PNG icon of at least 128 by 128 pixels', () => {
    expect(manifest.files).toContain(manifest.icon);
    const png = readFileSync(manifest.icon);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    // Width and height are the first fields of the IHDR chunk.
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(128);
    expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(128);
  });

  it('keeps the English and Turkish manifest strings in sync', () => {
    const en = Object.keys(readJson('package.nls.json')).sort();
    const tr = Object.keys(readJson('package.nls.tr.json')).sort();
    expect(tr).toEqual(en);
  });
});

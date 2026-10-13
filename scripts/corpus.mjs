// Opens every Office file in a folder in the viewer and sums up how it went: which files show,
// which the viewer explains it can't show, which get stuck, and which log errors.
// Usage: npm run corpus -- <folder>
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const folder = process.argv[2];
if (!folder || !existsSync(folder)) {
  console.error('Usage: npm run corpus -- <folder with .docx, .xlsx and .pptx files>');
  process.exit(1);
}
const report = resolve('test-results/corpus.jsonl');
mkdirSync('test-results', { recursive: true });
rmSync(report, { force: true });

spawnSync('npx', ['playwright', 'test', 'test/visual/corpus.spec.ts', '--reporter=dot'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CORPUS_DIR: resolve(folder), CORPUS_REPORT: report },
});

const results = existsSync(report)
  ? readFileSync(report, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  : [];
const by = (outcome) => results.filter((result) => result.outcome === outcome);
const noisy = by('shown').filter((result) => result.problems.length > 0);
const slow = by('shown').filter((result) => result.ms > 3000);

console.log(
  `\n${results.length} files: ${by('shown').length} shown, ${by('refused').length} refused, ${by('stuck').length} stuck`,
);
const list = (title, items, detail) => {
  if (items.length === 0) return;
  console.log(`\n${title} (${items.length}):`);
  for (const item of items) console.log(`  ${item.file}: ${detail(item)}`);
};
list('Stuck', by('stuck'), (r) => `${r.problems[0] ?? 'no error logged'}`);
list('Refused', by('refused'), (r) => r.message);
list('Shown with errors logged', noisy, (r) => r.problems[0]);
list('Slow (over 3 s)', slow, (r) => `${r.ms} ms, ${Math.round(r.bytes / 1024)} KB`);
console.log(`\nDetails: ${report}`);

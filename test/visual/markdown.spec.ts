import { expect, test, type Page } from '@playwright/test';
import { lastSent, openComparison } from './comparison';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

type Viewer = Awaited<ReturnType<typeof openViewer>>;

const scrollTo = (page: Page, top: number) =>
  page.locator('.ov-viewport').evaluate((el, value) => (el.scrollTop = value), top);

async function reference(viewer: Viewer) {
  const message = await lastSent<{ location: string; text?: string }>(viewer, 'reference');
  return message && { location: message.location, text: message.text };
}

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`renders Markdown readably in the ${theme} theme`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('markdown/sample.md');

    await expect(page.locator('.md-body h1')).toHaveText('Release checklist');
    await expect(page.locator('.ov-file-name')).toHaveText('sample.md');
    // Markdown is drawn in the theme's colors; there are no original colors to switch to.
    await expect(page.locator('[data-action="colors"]')).toBeHidden();
    await expect(page.locator('[data-action="open"]')).toHaveText('Edit');
    expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${SCREENS}/markdown-${theme}.png` });
    await scrollTo(page, 700);
    await page.screenshot({ path: `${SCREENS}/markdown-${theme}-2.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('shows front matter as properties, and as YAML on request', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('markdown/sample.md');

  const props = page.locator('.md-props');
  await expect(props.locator('.md-props-count')).toHaveText('7');
  await expect(props.locator('.md-prop[data-key="title"] dd')).toHaveText('Release checklist');
  await expect(props.locator('.md-prop[data-key="tags"] .md-chip')).toHaveText([
    'release',
    'checklist',
    'ci',
  ]);
  await expect(props.locator('.md-prop[data-key="draft"] .md-prop-bool')).toHaveAttribute(
    'data-value',
    'false',
  );
  await expect(props.locator('.md-props-nested .md-prop dt').first()).toHaveText('name');

  await props.locator('.md-props-toggle').click();
  await expect(props.locator('> .md-props-list')).toBeHidden();
  await expect(props.locator('.md-props-source')).toContainText('reviewers:');
  // Colored like code.
  await expect(props.locator('.md-props-source .hljs-attr').first()).toHaveText('title:');

  // The choice survives a save of the file.
  await viewer.load('markdown/sample.md', true);
  await expect(page.locator('.md-props-source')).toBeVisible();
  expect(viewer.problems).toEqual([]);
});

test('shows an AI agent file: tools as chips, prompt tags framed', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('markdown/agent.md');

  await expect(page.locator('.md-prop[data-key="tools"] .md-chip')).toHaveText([
    'Read',
    'Grep',
    'Glob',
    'Bash',
  ]);
  await expect(page.locator('.md-prop[data-key="description"] dd')).toHaveText(
    'Reviews changed code for bugs, security problems and readability. Use it after writing or changing code.',
  );
  const instructions = page.locator('.md-xml[data-tag="instructions"]');
  await expect(instructions.locator('> .md-xml-tag').first()).toHaveText('<instructions>');
  await expect(instructions.locator('li')).toHaveCount(3);
  await expect(page.locator('.md-xml[data-tag="example"] .md-xml-body')).toContainText(
    'user: Review my change',
  );
  await expect(page.locator('code.md-xml-inline')).toHaveText('<answer>');
  await expect(page.locator('.md-xml-tag').last()).toHaveText('<rules strict="true" />');
  await page.screenshot({ path: `${SCREENS}/markdown-agent-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('reports front matter that is not valid YAML, with the line', async ({ page }) => {
  const viewer = await openViewer(page, 'light');
  await viewer.load('markdown/broken-front-matter.md');

  await expect(page.locator('.md-props-error')).toContainText("isn't valid YAML");
  await expect(page.locator('.md-props-error')).toContainText('line 5');
  await expect(page.locator('.md-props-source')).toContainText('tools: [Read, Grep');
  await expect(page.locator('.md-body h1')).toHaveText('Summarizer');
  await page.screenshot({ path: `${SCREENS}/markdown-broken-light.png` });
  expect(viewer.problems).toEqual([]);
});

test('renders GitHub features: alerts, tasks, tables, footnotes, details', async ({ page }) => {
  const viewer = await openViewer(page, 'light');
  await viewer.load('markdown/sample.md');
  const body = page.locator('.md-body');

  await expect(body.locator('.md-alert-title')).toHaveText(['Note', 'Warning']);
  await expect(body.locator('.md-task-box[aria-checked="true"]')).toHaveCount(2);
  await expect(body.locator('.md-task-box[aria-checked="false"]')).toHaveCount(1);
  await expect(body.locator('td.md-align-right').first()).toHaveText('4 s');
  await expect(body.locator('.md-code[data-lang="ts"] .hljs-keyword').first()).toHaveText('const');
  await expect(body.locator('.footnote-ref a')).toHaveText('1');
  await expect(body.locator('details p')).toBeHidden();
  await body.locator('summary').click();
  await expect(body.locator('details p')).toBeVisible();
  await expect(body.locator('kbd')).toHaveText(['Ctrl', 'C']);
  expect(viewer.problems).toEqual([]);
});

test('shows pictures next to the file and stays offline for the web ones', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('markdown/sample.md');

  const flow = page.locator('img[alt="Release flow"]');
  await expect(flow).toHaveAttribute('src', /^blob:/);
  expect(await flow.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(560);
  // Badges show their text; other web pictures a placeholder. Nothing is downloaded.
  await expect(page.locator('.md-badge')).toHaveText(['Build', 'Coverage']);
  await expect(page.locator('.md-web-image')).toHaveText('Store listing');
  await expect(page.locator('.md-web-image')).toHaveAttribute('title', /stays offline/);
  await expect(page.locator('img[src^="http"]')).toHaveCount(0);
  const requested = (await viewer.sent()).filter((m) => m.type === 'resource');
  expect(requested).toEqual([
    { type: 'resource', id: expect.any(Number), href: 'images/flow.svg' },
  ]);
  expect(viewer.problems).toEqual([]);
});

test('follows links: headings in place, everything else through VS Code', async ({ page }) => {
  // Short enough that the last heading can scroll to the top.
  await page.setViewportSize({ width: 1100, height: 400 });
  const viewer = await openViewer(page, 'dark');
  await viewer.load('markdown/sample.md');

  await page.locator('a', { hasText: 'Publishing' }).click();
  await expect
    .poll(() =>
      page.locator('h2[data-anchor="publishing"]').evaluate((el) => el.getBoundingClientRect().top),
    )
    .toBeLessThan(120);

  await page.locator('a', { hasText: 'contributing guide' }).click();
  await expect
    .poll(() => lastSent(viewer, 'openLink'))
    .toEqual({
      type: 'openLink',
      href: '../../../CONTRIBUTING.md',
    });
  await page.locator('a', { hasText: 'release page' }).click();
  await expect
    .poll(async () => (await lastSent<{ href: string }>(viewer, 'openLink'))?.href)
    .toBe('https://github.com/mbKalkan/nightdocs/releases');
  expect(viewer.problems).toEqual([]);
});

test('copies a code block, and opens the text editor where the view is', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('markdown/sample.md');

  const block = page.locator('.md-code[data-lang="bash"]');
  await block.locator('.md-code-copy').click();
  await expect
    .poll(() => lastSent(viewer, 'copyText'))
    .toEqual({ type: 'copyText', text: 'npm run typecheck && npm run lint\nnpm test' });
  await expect(block.locator('.md-code-copy')).toHaveAttribute('title', 'Copied');

  await page.locator('h2', { hasText: 'Verify' }).evaluate((el) => el.scrollIntoView());
  await page.locator('[data-action="open"]').click();
  // "## Verify" is line 41 of the file.
  await expect
    .poll(async () => (await lastSent<{ line?: number }>(viewer, 'openInOffice'))?.line)
    .toBe(40);
  expect(viewer.problems).toEqual([]);
});

test('references lines, the heading above and front matter properties', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('markdown/sample.md');

  await page.locator('.md-body p', { hasText: 'Use this list' }).click({ button: 'right' });
  await viewer.post({ type: 'command', command: 'copyReference' });
  await expect
    .poll(() => reference(viewer))
    .toEqual({ location: 'lines 19-21, under "Release checklist"', text: undefined });

  await page.locator('.md-line', { hasText: 'npm test' }).click({ button: 'right' });
  await viewer.post({ type: 'command', command: 'copyReferenceWithText' });
  await expect
    .poll(() => reference(viewer))
    .toEqual({ location: 'line 34, under "Prepare"', text: '```bash\n   npm test\n```' });

  await page.locator('.md-prop[data-key="description"] dd').click({ button: 'right' });
  await viewer.post({ type: 'command', command: 'copyReferenceWithText' });
  await expect
    .poll(() => reference(viewer))
    .toEqual({
      location: 'line 3, front matter "description"',
      text: '> description: Steps to prepare, verify and publish a release of the extension.',
    });

  await page.locator('li', { hasText: 'Screenshots updated' }).click({ button: 'right' });
  await expect(page.locator('.ov-ref-mark')).toBeVisible();
  expect(viewer.problems).toEqual([]);
});

test('lists the headings in the navigation pane and Go to Heading', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('markdown/sample.md');

  await page.locator('[data-action="navigation"]').click();
  await expect(page.locator('.ov-nav-item')).toHaveText([
    'Release checklist',
    'Prepare',
    'Verify',
    'Publishing',
  ]);
  await page.locator('.ov-nav-item', { hasText: 'Verify' }).click();
  await expect(page.locator('.ov-nav-item[aria-current]')).toHaveText('Verify');

  await viewer.post({ type: 'command', command: 'goTo' });
  const pick = await lastSent<{ items: { label: string; description?: string }[] }>(viewer, 'pick');
  expect(pick?.items.map((item) => item.description)).toEqual([
    'line 15',
    'line 26',
    'current · line 41',
    'line 54',
  ]);
  await page.screenshot({ path: `${SCREENS}/markdown-navigation-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('scrolls along with the text editor', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 400 });
  const viewer = await openViewer(page, 'dark');
  await viewer.load('markdown/sample.md');

  // "## Publishing" is line 54 of the file; the editor counts from 0.
  await viewer.post({ type: 'revealLine', line: 53 });
  const top = () =>
    page.locator('h2', { hasText: 'Publishing' }).evaluate((el) => el.getBoundingClientRect().top);
  await expect.poll(top).toBeLessThan(60);
  await expect.poll(top).toBeGreaterThan(20);
  expect(viewer.problems).toEqual([]);
});

test('shows changes as they are typed, keeping the place', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('markdown/sample.md');
  await scrollTo(page, 500);
  await viewer.load('markdown/sample-revised.md', true);
  await expect(page.locator('h2', { hasText: 'Announce' })).toHaveCount(1);
  expect(await page.locator('.ov-viewport').evaluate((el) => el.scrollTop)).toBeGreaterThan(400);
  expect(viewer.problems).toEqual([]);
});

test('says when a Markdown file is empty', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.post({
    type: 'load',
    fileName: 'empty.md',
    format: 'md',
    data: new Uint8Array(),
    reload: false,
    canOpenInOffice: true,
    colorMode: 'dark',
    navigationPane: false,
    locale: 'en-US',
    strings: (await import('./harness')).strings,
  });
  await expect(page.locator('.md-empty')).toHaveText('The file is empty.');
  expect(viewer.problems).toEqual([]);
});

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`compares two versions of a Markdown file in the ${theme} theme`, async ({ browser }) => {
    const pages = [await browser.newPage(), await browser.newPage()] as [Page, Page];
    const [original, modified] = await openComparison(
      pages,
      theme,
      ['markdown/sample.md', 'markdown/sample-revised.md'],
      700,
    );

    for (const side of [original, modified]) {
      await expect(side.page.locator('.ov-diff-status')).toHaveText('10 changes');
      // The overview ruler beside the scrollbar shows where they are.
      await expect(side.page.locator('.ov-overview')).toBeVisible();
    }
    // Properties compare one by one: the description changed, a tag was added.
    await expect(
      original.page.locator('.md-prop[data-key="description"] .nd-diff-word.nd-diff-removed'),
    ).toHaveText('publish');
    await expect(
      modified.page.locator('.md-prop[data-key="description"] .nd-diff-word.nd-diff-added'),
    ).toHaveText([',', 'publish', 'announce']);
    await expect(modified.page.locator('.md-prop[data-key="tags"]')).toHaveClass(/nd-diff-added/);
    // A line of code, a table cell, a section added and one removed.
    await expect(
      modified.page.locator('.md-line.nd-diff-added', { hasText: '--coverage' }),
    ).toHaveCount(1);
    await expect(modified.page.locator('td .nd-diff-word.nd-diff-added')).toHaveText('6');
    await expect(modified.page.locator('h2.nd-diff-added')).toHaveText('Announce');
    await expect(original.page.locator('summary.nd-diff-removed')).toHaveText('Troubleshooting');
    // Removed lanes on the left of the ruler, added on the right.
    await expect(original.page.locator('.ov-overview-removed').first()).toBeVisible();
    await expect(modified.page.locator('.ov-overview-added').first()).toBeVisible();

    await original.page.screenshot({ path: `${SCREENS}/markdown-diff-${theme}-original.png` });
    await modified.page.screenshot({ path: `${SCREENS}/markdown-diff-${theme}-modified.png` });

    // A click on a change in the ruler goes to it, like the arrows do.
    const last = modified.page.locator('.ov-overview-added').last();
    // Marks let clicks through to the ruler, as a click on the strip does.
    await last.click({ force: true });
    await expect(modified.page.locator('.ov-diff-status')).toHaveText('Change 10 of 10');
    await expect(modified.page.locator('h2', { hasText: 'Announce' })).toBeInViewport();

    expect(original.viewer.problems).toEqual([]);
    expect(modified.viewer.problems).toEqual([]);
  });
}

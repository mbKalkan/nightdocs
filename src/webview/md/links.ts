import { vscode } from '../vscodeApi';

/**
 * Follows links clicked in a rendered Markdown file. Links to a heading or a footnote scroll
 * there; others go to the extension host, which opens files in VS Code and web pages in the
 * browser, asking first when VS Code doesn't trust the site.
 */
export function followLinks(page: HTMLElement, reveal: (anchor: string) => void): void {
  for (const link of page.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    // A webview has no status bar to show where a link goes.
    if (!href.startsWith('#') && !link.title) link.title = href;
  }
  page.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || !page.contains(link)) return;
    // VS Code's own handling would resolve relative links against the webview.
    event.preventDefault();
    event.stopPropagation();
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) reveal(decodeFragment(href.slice(1)));
    else if (href) vscode.postMessage({ type: 'openLink', href });
  });
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** The element a link's `#anchor` points at: a heading by its GitHub id, or any id or name. */
export function anchorTarget(root: Element, anchor: string): HTMLElement | undefined {
  const id = anchor.replace(/^user-content-/, '');
  const escaped = CSS.escape(id);
  return (
    root.querySelector<HTMLElement>(`[data-anchor="${escaped}"]`) ??
    root.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(id.toLowerCase())}"]`) ??
    root.querySelector<HTMLElement>(`[id="${escaped}"], [name="${escaped}"]`) ??
    undefined
  );
}

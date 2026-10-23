import { vscode } from './vscodeApi';

/** Web and mail links; others, like file paths, aren't followed from a document. */
export function isWebLink(url: string): boolean {
  return /^(https?|mailto):/i.test(url);
}

/**
 * Has VS Code open a web or mail link, asking first for sites it doesn't trust. The host opens
 * it: VS Code ignores clicks a script makes on a link in a webview.
 */
export function followLink(url: string): void {
  if (isWebLink(url)) vscode.postMessage({ type: 'openLink', href: url });
}

/** The modifier VS Code names for following links with a click: Cmd on macOS, Ctrl elsewhere. */
export const LINK_MODIFIER = /^Mac/.test(navigator.platform) ? 'Cmd' : 'Ctrl';

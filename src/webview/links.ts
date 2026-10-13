/** Web and mail links; others, like file paths, aren't followed from a document. */
export function isWebLink(url: string): boolean {
  return /^(https?|mailto):/i.test(url);
}

/** Hands a link to VS Code the way a click on a document link would, so it asks first. */
export function followLink(url: string): void {
  if (!isWebLink(url)) return;
  const link = document.createElement('a');
  link.href = url;
  link.click();
}

/** The modifier VS Code names for following links with a click: Cmd on macOS, Ctrl elsewhere. */
export const LINK_MODIFIER = /^Mac/.test(navigator.platform) ? 'Cmd' : 'Ctrl';

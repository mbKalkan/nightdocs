import DOMPurify, { type Config } from 'dompurify';

/**
 * What raw HTML in a Markdown file may keep, close to what GitHub allows: formatting, tables,
 * pictures, details. No scripts, styles, forms, frames or media players; the webview's policy
 * would block most of them anyway, and a viewer has no use for them.
 */
const CONFIG: Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: [
    'style',
    'link',
    'meta',
    'base',
    'form',
    'input',
    'button',
    'select',
    'option',
    'textarea',
    'dialog',
    'template',
    'slot',
    'iframe',
    'object',
    'embed',
    'video',
    'audio',
    'track',
  ],
  // Inline styles could restyle or cover the viewer itself.
  FORBID_ATTR: ['style'],
};

/**
 * Where a picture's address is kept until the view decides how to show it. A picture with a
 * `src` starts loading as soon as it is created, which for one on the web means going online
 * before the user chose to.
 */
export const PICTURE_SRC = 'data-nd-src';
export const PICTURE_SRCSET = 'data-nd-srcset';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName !== 'IMG' && node.nodeName !== 'SOURCE') return;
  for (const [from, to] of [
    ['src', PICTURE_SRC],
    ['srcset', PICTURE_SRCSET],
  ]) {
    const value = node.getAttribute(from);
    if (value === null) continue;
    node.setAttribute(to, value);
    node.removeAttribute(from);
  }
});

export function sanitize(html: string): DocumentFragment {
  return DOMPurify.sanitize(html, { ...CONFIG, RETURN_DOM_FRAGMENT: true });
}

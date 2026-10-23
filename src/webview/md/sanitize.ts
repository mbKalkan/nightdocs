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

export function sanitize(html: string): DocumentFragment {
  return DOMPurify.sanitize(html, { ...CONFIG, RETURN_DOM_FRAGMENT: true });
}

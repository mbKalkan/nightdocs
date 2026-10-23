import type { ViewerStrings } from '../../shared/protocol';
import { requestResource } from '../resources';

/** Pictures read once per viewer: the file shown is the same one, saved again and again. */
const cache = new Map<string, Promise<string | undefined>>();

/** How long a render waits for pictures, so the layout is mostly settled when it shows. */
const WAIT_MS = 800;

/** Hosts that serve status badges, shown as a label with their text instead of a picture. */
const BADGE_HOSTS =
  /(^|\.)(shields\.io|badgen\.net|badge\.fury\.io|vsmarketplacebadges\.dev|codecov\.io|coveralls\.io|circleci\.com|travis-ci\.(org|com)|codacy\.com|snyk\.io|deepwiki\.com|pepy\.tech|npmjs\.com)$/i;

const isWeb = (src: string) => /^(https?:)?\/\//i.test(src);

/**
 * Shows the pictures of a rendered Markdown file. Files next to it are read through the host.
 * Pictures on the web aren't downloaded, since the viewer never goes online: a badge shows its
 * text, another picture a placeholder with its description.
 */
export async function showPictures(
  root: HTMLElement,
  strings: ViewerStrings,
  darkTheme: boolean,
): Promise<void> {
  for (const picture of root.querySelectorAll('picture')) choosePictureSource(picture, darkTheme);

  const loads: Promise<void>[] = [];
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src')?.trim() ?? '';
    if (!src || /^data:image\//i.test(src)) continue;
    img.removeAttribute('src');
    img.removeAttribute('srcset');
    if (isWeb(src)) {
      img.replaceWith(webPlaceholder(img, src, strings));
    } else {
      img.dataset.href = src;
      loads.push(load(img, src, strings));
    }
  }
  if (loads.length > 0) {
    await Promise.race([
      Promise.all(loads),
      new Promise((resolve) => setTimeout(resolve, WAIT_MS)),
    ]);
  }
}

/**
 * `<picture>` with a `<source>` for dark color schemes (as GitHub READMEs do for logos): use the
 * one that fits the theme, as the browser would for the system's scheme.
 */
function choosePictureSource(picture: HTMLPictureElement, darkTheme: boolean): void {
  const img = picture.querySelector('img');
  const scheme = darkTheme ? 'dark' : 'light';
  const source = [...picture.querySelectorAll('source')].find((s) =>
    (s.getAttribute('media') ?? '').includes(`prefers-color-scheme: ${scheme}`),
  );
  const srcset = source?.getAttribute('srcset')?.trim().split(/\s+/)[0];
  if (img && srcset) img.setAttribute('src', srcset);
  picture.querySelectorAll('source').forEach((s) => s.remove());
}

async function load(img: HTMLImageElement, href: string, strings: ViewerStrings): Promise<void> {
  let url = cache.get(href);
  if (!url) {
    url = requestResource(href).then((message) =>
      message.data
        ? URL.createObjectURL(new Blob([message.data as BlobPart], { type: message.mime }))
        : undefined,
    );
    cache.set(href, url);
  }
  const blob = await url;
  if (blob) {
    img.src = blob;
    await img.decode().catch(() => undefined);
  } else {
    const missing = placeholder(
      'md-missing-image',
      img.alt || href,
      strings.missingImage.replace('{0}', href),
    );
    missing.dataset.href = href;
    img.replaceWith(missing);
  }
}

function webPlaceholder(img: HTMLImageElement, src: string, strings: ViewerStrings): HTMLElement {
  const url = src.startsWith('//') ? `https:${src}` : src;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // Shown with its description only.
  }
  const title = strings.remoteImage.replace('{0}', url);
  const badge = BADGE_HOSTS.test(host) || /\/badge(\.svg)?([?#]|$)/i.test(url);
  const shown = badge
    ? placeholder('md-badge', img.alt || host, title)
    : placeholder('md-web-image', img.alt || host || url, title);
  shown.dataset.src = url;
  return shown;
}

function placeholder(className: string, text: string, title: string): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', text);
  element.title = title;
  const label = document.createElement('span');
  label.textContent = text;
  element.append(label);
  return element;
}

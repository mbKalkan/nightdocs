import type { ViewerStrings } from '../../shared/protocol';
import { requestResource } from '../resources';
import { PICTURE_SRC, PICTURE_SRCSET } from './sanitize';

/** Pictures read once per viewer: the file shown is the same one, saved again and again. */
const cache = new Map<string, Promise<string | undefined>>();

/** How long a render waits for pictures, so the layout is mostly settled when it shows. */
const WAIT_MS = 800;

/** Hosts that serve status badges, shown as a label with their text until they are shown. */
const BADGE_HOSTS =
  /(^|\.)(shields\.io|badgen\.net|badge\.fury\.io|vsmarketplacebadges\.dev|codecov\.io|coveralls\.io|circleci\.com|travis-ci\.(org|com)|codacy\.com|snyk\.io|deepwiki\.com|pepy\.tech|npmjs\.com)$/i;

const isWeb = (src: string) => /^(https?:)?\/\//i.test(src);

/** Only pictures served securely are loaded from the web (the webview's policy allows https). */
const canLoad = (url: string) => /^https:\/\//i.test(url);

export interface Pictures {
  /** How many pictures from the web aren't shown yet and could be. */
  readonly hidden: number;
  /** Shows the pictures from the web; the viewer goes online for them. */
  showOnline(): void;
}

/**
 * Shows the pictures of a rendered Markdown file. Files next to it are read through the host.
 * Pictures on the web are only loaded with `online` (the user's choice); until then a badge
 * shows its text and another picture a placeholder with its description.
 */
export async function showPictures(
  root: HTMLElement,
  strings: ViewerStrings,
  darkTheme: boolean,
  online: boolean,
): Promise<Pictures> {
  for (const picture of root.querySelectorAll('picture')) choosePictureSource(picture, darkTheme);

  const loads: Promise<void>[] = [];
  const waiting = new Map<HTMLElement, { img: HTMLImageElement; url: string }>();
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute(PICTURE_SRC)?.trim() ?? '';
    img.removeAttribute(PICTURE_SRC);
    img.removeAttribute(PICTURE_SRCSET);
    if (!src) continue;
    if (/^data:image\//i.test(src)) {
      img.src = src;
    } else if (isWeb(src)) {
      const url = src.startsWith('//') ? `https:${src}` : src;
      const shown = webPlaceholder(img, url, strings);
      img.dataset.src = url;
      img.replaceWith(shown);
      if (!canLoad(url)) continue;
      if (online) loadWeb(img, url, shown);
      else waiting.set(shown, { img, url });
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
  return {
    hidden: waiting.size,
    showOnline() {
      for (const [shown, { img, url }] of waiting) loadWeb(img, url, shown);
      waiting.clear();
    },
  };
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
  const srcset = source?.getAttribute(PICTURE_SRCSET)?.trim().split(/\s+/)[0];
  if (img && srcset) img.setAttribute(PICTURE_SRC, srcset);
  picture.querySelectorAll('source').forEach((s) => s.remove());
}

/** Swaps a placeholder for its picture from the web; the placeholder comes back if it fails. */
function loadWeb(img: HTMLImageElement, url: string, shown: HTMLElement): void {
  // The webview's address says nothing useful to the site, and nothing it should learn.
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => img.replaceWith(shown), { once: true });
  img.src = url;
  shown.replaceWith(img);
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
    const shown = await img.decode().then(
      () => true,
      () => false,
    );
    if (shown) return;
  }
  // Asked again next time: the file may be added or fixed while the view is open.
  if (cache.get(href) === url) cache.delete(href);
  const missing = placeholder(
    'md-missing-image',
    img.alt || href,
    strings.missingImage.replace('{0}', href),
  );
  missing.dataset.href = href;
  img.replaceWith(missing);
}

function webPlaceholder(img: HTMLImageElement, url: string, strings: ViewerStrings): HTMLElement {
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

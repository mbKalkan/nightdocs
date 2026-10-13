import type { ViewerStrings } from '../../shared/protocol';
import { NavList } from '../navList';
import type { NavigationContent } from '../renderers/types';

export interface SlideEntry {
  frame: HTMLElement;
  title: string;
  hidden: boolean;
}

/**
 * The slides in the navigation pane as small pictures, like PowerPoint's slide pane. Each is a
 * copy of the slide drawn smaller, made when it scrolls into the pane.
 */
export function slidesPane(
  slides: readonly SlideEntry[],
  actions: { select(index: number): void; current(): number },
  viewport: HTMLElement,
  strings: ViewerStrings,
): NavigationContent {
  const boxes: HTMLElement[] = [];
  const list = new NavList(
    slides.map(({ frame, title, hidden }, index) => {
      const preview = document.createElement('span');
      preview.className = 'ov-nav-preview';
      const number = document.createElement('span');
      number.className = 'ov-nav-number';
      number.textContent = String(index + 1);
      // The label already says which slide it is.
      number.setAttribute('aria-hidden', 'true');
      const box = document.createElement('span');
      box.className = 'ov-nav-thumb';
      box.style.aspectRatio = `${parseFloat(frame.style.width)} / ${parseFloat(frame.style.height)}`;
      boxes.push(box);
      preview.append(number, box);
      return {
        label: `${strings.slide.replace('{0}', String(index + 1))}${title ? `: ${title}` : ''}`,
        decoration: preview,
        muted: hidden,
      };
    }),
    actions,
    strings.slides,
    strings,
  );
  list.element.classList.add('ov-nav-thumbnails');

  const observer = new IntersectionObserver((seen) => {
    for (const { isIntersecting, target } of seen) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      const index = boxes.indexOf(target as HTMLElement);
      if (index >= 0) drawThumbnail(slides[index].frame, boxes[index]);
    }
  });
  boxes.forEach((box) => observer.observe(box));
  const stop = list.follow(viewport);
  return {
    title: strings.slides,
    element: list.element,
    dispose: () => {
      observer.disconnect();
      stop();
    },
  };
}

/** Copies a slide into its box, scaled to fit. Charts draw on canvases, which copy blank. */
function drawThumbnail(frame: HTMLElement, box: HTMLElement): void {
  const copy = frame.cloneNode(true) as HTMLElement;
  const canvases = frame.querySelectorAll('canvas');
  copy.querySelectorAll('canvas').forEach((canvas, index) => {
    try {
      const picture = document.createElement('img');
      picture.src = canvases[index].toDataURL();
      picture.style.cssText = canvas.style.cssText;
      canvas.replaceWith(picture);
    } catch {
      // A canvas that can't be read stays blank.
    }
  });
  copy.removeAttribute('aria-label');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.style.transform = `scale(${box.clientWidth / parseFloat(frame.style.width)})`;
  box.append(copy);
}

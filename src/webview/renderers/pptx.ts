import {
  buildPresentation,
  parseZip,
  RECOMMENDED_ZIP_LIMITS,
  renderSlide,
  type SlideData,
  type SlideHandle,
  type SlideRendererOptions,
} from '@aiden0z/pptx-renderer';
import type { DarkPalette } from '../../shared/color';
import type { SlideSummary, ViewerStrings } from '../../shared/protocol';
import { adaptDocumentColors, KEEP_COLORS_ATTRIBUTE } from '../darkColors';
import { compareSlides, summarizeSlides } from '../diff/slideCompare';
import { adaptChartOption, type Chart } from '../pptx/chartColors';
import { readNotes } from '../pptx/notes';
import { OBJECT, textOf } from '../diff/marks';
import { icons } from '../icons';
import { PageNavigator } from '../pageNavigator';
import { describe, pick } from '../picker';
import type { RenderContext, RenderedDocument, RenderOptions, Renderer } from './types';

/** Space around the slides; matches the padding of `.pptx-deck` in viewer.css. */
const DECK_GUTTER = 2 * 32;

const MB = 1024 * 1024;

/**
 * The library's recommended limits guard against ZIP bombs but turn away ordinary decks with an
 * embedded screen recording (32 MB per entry). These still stop a bomb well before the webview
 * runs out of memory.
 */
const ZIP_LIMITS = {
  ...RECOMMENDED_ZIP_LIMITS,
  maxEntryUncompressedBytes: 256 * MB,
  maxTotalUncompressedBytes: 512 * MB,
  maxMediaBytes: 512 * MB,
};

export const pptxRenderer: Renderer = {
  async render(
    data: Uint8Array,
    target: HTMLElement,
    options: RenderOptions,
  ): Promise<RenderedDocument> {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const presentation = buildPresentation(await parseZip(buffer as ArrayBuffer, ZIP_LIMITS));
    const notes = readNotes(
      data,
      presentation.slides.map((slide) => slide.slidePath),
    ).catch((): string[][] => []);
    const { strings } = options;

    const deck = document.createElement('div');
    deck.className = 'pptx-deck';
    target.append(deck);

    const charts: NonNullable<SlideRendererOptions['chartInstances']> = new Set();
    const mediaUrls = new Map<string, string>();
    const handles: SlideHandle[] = [];
    const frames: HTMLElement[] = [];
    let navigator: PageNavigator | undefined;

    for (const slide of presentation.slides) {
      const number = slide.index + 1;
      const frame = document.createElement('section');
      frame.className = 'pptx-slide';
      frame.style.width = `${presentation.width}px`;
      frame.style.height = `${presentation.height}px`;
      const label = strings.slide.replace('{0}', String(number));
      frame.setAttribute('aria-label', slide.hidden ? `${label}, ${strings.hiddenSlide}` : label);
      if (slide.hidden) frame.dataset.hidden = strings.hiddenSlide;
      const handle = renderSlide(presentation, slide, {
        chartInstances: charts,
        mediaUrlCache: mediaUrls,
        // PDF previews inside EMF pictures need pdf.js and a worker; they show as placeholders.
        pdfjs: false,
        onNavigate: (link) => {
          if (link.slideIndex !== undefined) navigator?.goTo(link.slideIndex);
          else if (link.url) followLink(link.url);
        },
      });
      frame.append(handle.element);
      deck.append(frame);
      handles.push(handle);
      frames.push(frame);
    }

    await Promise.all(handles.map((handle) => handle.ready));
    const notesShown = (options.previous as { notes?: boolean } | undefined)?.notes ?? true;
    deck.toggleAttribute('data-notes-hidden', !notesShown);
    const notesElements = addNotes(frames, await notes, strings.speakerNotes);
    await document.fonts.ready;

    const { palette } = options;
    const adapted = new Set<HTMLElement>();
    if (palette) {
      // Charts keep their data colors, so their legend keys must too.
      for (const key of deck.querySelectorAll('.pptx-chart-custom-legend svg')) {
        key.setAttribute(KEEP_COLORS_ATTRIBUTE, '');
      }
      for (const frame of frames) {
        if (hasPictureBackground(frame)) frame.dataset.colors = 'original';
        else adapted.add(frame);
      }
      adaptDocumentColors([...adapted], palette);
    }
    const slideCharts = frames.map((): Chart[] => []);
    for (const chart of charts) {
      const frame = chart.getDom().closest<HTMLElement>('.pptx-slide');
      settleChart(chart, frame && adapted.has(frame) ? palette : undefined);
      if (frame) slideCharts[frames.indexOf(frame)]?.push(chart);
    }

    // Only needed when comparing.
    const slides = { deck, frames, charts: slideCharts, notes: notesElements };
    let notesToggle: HTMLButtonElement | undefined;
    let summaries: Promise<SlideSummary[]> | undefined;
    const summarize = () => (summaries ??= summarizeSlides(slides));
    return {
      naturalWidth: presentation.width + DECK_GUTTER,
      activate(context: RenderContext) {
        navigator = new PageNavigator(context, frames, strings.slidePosition);
        if (notesElements.some(Boolean)) {
          notesToggle = notesButton(deck, strings);
          context.footer.append(notesToggle);
        }
      },
      state: () => ({ notes: !deck.hasAttribute('data-notes-hidden') }),
      command(command) {
        if (command !== 'goTo' || !navigator) return;
        const current = navigator.current;
        const items = presentation.slides.map((slide, index) => ({
          label: `${index + 1}. ${slideTitle(slide, frames[index]) || strings.slide.replace('{0}', String(index + 1))}`,
          description: describe(
            index === current && strings.current,
            slide.hidden && strings.hiddenSlide,
          ),
          current: index === current,
        }));
        void pick(strings.goToSlide.replace('{0}', String(items.length)), items).then(
          (index) => index !== undefined && navigator?.goTo(index),
        );
      },
      summary: async () => ({ format: 'pptx', slides: await summarize() }),
      compare: async (peer, side, context) =>
        peer.format === 'pptx'
          ? compareSlides(slides, await summarize(), peer.slides, side, context)
          : undefined,
      dispose() {
        navigator?.dispose();
        notesToggle?.remove();
        for (const handle of handles) handle.dispose();
        for (const chart of charts) if (!chart.isDisposed()) chart.dispose();
        for (const url of mediaUrls.values()) URL.revokeObjectURL(url);
      },
    };
  },
};

/** Puts each slide's speaker notes under it, as PowerPoint's notes pane does. */
function addNotes(
  frames: readonly HTMLElement[],
  notes: readonly string[][],
  label: string,
): (HTMLElement | undefined)[] {
  return frames.map((frame, index) => {
    const paragraphs = notes[index] ?? [];
    if (paragraphs.length === 0) return undefined;
    const element = document.createElement('div');
    element.className = 'pptx-notes';
    element.style.width = frame.style.width;
    element.setAttribute('role', 'note');
    element.setAttribute('aria-label', label);
    for (const text of paragraphs) {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      element.append(paragraph);
    }
    frame.after(element);
    return element;
  });
}

/** The status bar switch that shows or hides the speaker notes. */
function notesButton(deck: HTMLElement, strings: ViewerStrings): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ov-status-button';
  button.innerHTML = icons.notes;
  button.append(strings.notes);
  const update = () => {
    const shown = !deck.hasAttribute('data-notes-hidden');
    button.setAttribute('aria-pressed', String(shown));
    button.title = shown ? strings.hideNotes : strings.showNotes;
  };
  button.addEventListener('click', () => {
    deck.toggleAttribute('data-notes-hidden');
    update();
  });
  update();
  return button;
}

/**
 * A slide's title: the text of its title placeholder, or else its first line of text, as in
 * PowerPoint's outline.
 */
function slideTitle(slide: SlideData, frame: HTMLElement | undefined): string {
  for (const node of slide.nodes) {
    const type = node.placeholder?.type;
    if ((type === 'title' || type === 'ctrTitle') && 'textBody' in node && node.textBody) {
      const text = node.textBody.paragraphs
        .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
        .join(' ')
        .trim();
      if (text) return text;
    }
  }
  const lines = frame ? textOf(frame).split('\n') : [];
  return (
    lines.map((line) => line.replaceAll(OBJECT, '').replace(/\s+/g, ' ').trim()).find(Boolean) ?? ''
  );
}

/**
 * Draws a chart once more without its opening animation, which only delays reading it,
 * and with colors for a dark theme when `palette` is given. Series data is replaced rather
 * than merged by `setOption`, so the whole option goes back.
 */
function settleChart(chart: Chart, palette: DarkPalette | undefined): void {
  const option = chart.getOption();
  const next = palette ? adaptChartOption(option, palette) : { ...option };
  chart.setOption({ ...next, animation: false }, { notMerge: true });
}

/**
 * Slides drawn on a picture or gradient keep their original colors, like pictures do: their
 * text was chosen for that background, which the color pass can't adapt.
 */
function hasPictureBackground(frame: HTMLElement): boolean {
  const slide = frame.firstElementChild;
  // The background is the slide itself or a full-size layer at the bottom of it.
  const layers = [slide, slide?.firstElementChild, slide?.firstElementChild?.firstElementChild];
  return layers.some(
    (layer) =>
      layer instanceof HTMLElement &&
      layer.offsetWidth >= frame.offsetWidth &&
      layer.offsetHeight >= frame.offsetHeight &&
      getComputedStyle(layer).backgroundImage !== 'none',
  );
}

/** Hands a link to VS Code the way a click on a document link would, so it asks first. */
function followLink(url: string): void {
  if (!/^(https?|mailto):/i.test(url)) return;
  const link = document.createElement('a');
  link.href = url;
  link.click();
}

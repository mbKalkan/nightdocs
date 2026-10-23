import './styles/viewer.css';
import './styles/markdown.css';
import { formatCssColor } from '../shared/color';
import { detectContainer, isTextFormat } from '../shared/formats';
import type {
  HostToWebviewMessage,
  LoadMessage,
  ReadErrorMessage,
  ViewerStrings,
} from '../shared/protocol';
import { isDamaged } from './damaged';
import { isDarkTheme, readPalette } from './darkColors';
import { DiffController } from './diff/controller';
import { picked } from './picker';
import { fadeMark, lastContextTarget, trackContextMenu } from './reference';
import { loadRenderer } from './renderers';
import { resourceArrived } from './resources';
import type { NavigationContent, RenderContext, RenderedDocument } from './renderers/types';
import { Shell } from './shell';
import { vscode, type ViewState } from './vscodeApi';
import { ZoomController } from './zoomController';

const saved: ViewState = vscode.getState() ?? { zoom: null, scrollRatio: 0 };
let fixedZoom = saved.zoom;
let hasContent = false;
let renderId = 0;
/** The last document received, kept to re-render when colors or the theme change. */
let lastLoad: LoadMessage | undefined;
/** The document currently on screen. */
let current: RenderedDocument | undefined;
let themeKey = currentThemeKey();
/** Present when this viewer is one side of a comparison. */
const diff = new DiffController();
/** The live parts of the viewer the document on screen was given. */
let renderContext: RenderContext | undefined;
/** Whether the navigation pane is open, and what it shows. */
let navigationOpen = false;
let navigation: NavigationContent | undefined;
/** One side of a comparison: half a window is too narrow to keep the pane open by default. */
let comparing = false;

const shell = new Shell(document.getElementById('app') as HTMLElement, {
  onToggleNavigation: toggleNavigation,
  onZoomIn: () => zoom.zoomIn(),
  onZoomOut: () => zoom.zoomOut(),
  onResetZoom: () => zoom.reset(),
  // Markdown opens in the text editor where the view is.
  onOpenInOffice: () => vscode.postMessage({ type: 'openInOffice', line: current?.sourceLine?.() }),
  onToggleColors: toggleColors,
});
shell.setZoomEnabled(false);
trackContextMenu(shell.viewport, (hit) => current?.referenceMark?.(hit));

const zoom = new ZoomController(
  {
    viewport: shell.viewport,
    content: shell.content,
    onChange: (value, fixed) => {
      fixedZoom = fixed;
      shell.setZoom(value);
      current?.refresh?.();
      saveState();
      diff.zoomed(fixed);
    },
  },
  saved.zoom,
);

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'load':
      void show(message);
      break;
    case 'readError':
      showReadError(message);
      break;
    case 'zoom':
      if (hasContent) {
        if (message.action === 'in') zoom.zoomIn();
        else if (message.action === 'out') zoom.zoomOut();
        else zoom.reset();
      }
      break;
    case 'command':
      if (message.command === 'toggleNavigation') toggleNavigation();
      else if (message.command === 'copyReference') copyReference(false);
      else if (message.command === 'copyReferenceWithText') copyReference(true);
      else current?.command?.(message.command);
      break;
    case 'picked':
      picked(message.index);
      break;
    case 'diff':
      diff.setSide(message.side);
      setComparing(message.side !== undefined);
      break;
    case 'peerSummary':
      diff.setPeer(message.summary);
      break;
    case 'peerScroll':
      diff.follow(message.anchor);
      break;
    case 'peerSelect':
      void diff.followSelection(message.selection);
      break;
    case 'peerZoom':
      if (hasContent) diff.followZoom(message.zoom, (value) => zoom.set(value));
      break;
    case 'resource':
      resourceArrived(message);
      break;
    case 'revealLine':
      if (hasContent && !comparing) current?.revealLine?.(message.line);
      break;
  }
});

shell.viewport.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey || !hasContent) {
      return;
    }
    event.preventDefault();
    const bounds = shell.viewport.getBoundingClientRect();
    zoom.zoomBy(Math.exp(-event.deltaY * 0.002), {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  },
  { passive: false },
);

let scrollFrame = 0;
shell.viewport.addEventListener('scroll', () => {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(saveState);
});

// VS Code swaps body classes and CSS variables when the color theme changes.
let themeTimer: ReturnType<typeof setTimeout> | undefined;
const themeObserver = new MutationObserver(() => {
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => {
    const key = currentThemeKey();
    if (key !== themeKey) {
      themeKey = key;
      rerender();
    }
  }, 50);
});
themeObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ['class', 'data-vscode-theme-kind'],
});
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

vscode.postMessage({ type: 'ready' });

/** Hands the host the place last right-clicked, or in view, to put on the clipboard. */
function copyReference(withText: boolean): void {
  const reference = current?.reference?.(lastContextTarget(), withText);
  if (!reference) return;
  vscode.postMessage({ type: 'reference', ...reference });
  fadeMark();
}

async function show(message: LoadMessage): Promise<void> {
  const id = ++renderId;
  lastLoad = message;
  // A file caught mid-save can be incomplete; keep showing the last good render in that case.
  const keepOnFailure = message.reload && hasContent;
  shell.setDocument(message.fileName, message.format, message.canOpenInOffice, message.strings);

  const container = isTextFormat(message.format) ? 'text' : detectContainer(message.data);
  if (container !== 'zip' && container !== 'text') {
    if (!keepOnFailure) {
      // An empty file is common: VS Code's "New File…" with a .docx or .xlsx name makes one.
      const reason =
        message.data.length === 0
          ? message.strings.errorEmpty
          : container === 'cfb'
            ? message.strings.errorProtectedOrLegacy
            : message.strings.errorDamaged;
      showError(message, reason);
    }
    return;
  }

  const darkTheme = isDarkTheme();
  const palette = darkTheme && message.colorMode === 'dark' ? readPalette() : undefined;

  shell.setBusy(true);
  if (!hasContent) shell.showSkeleton(message.format);
  // Render off-screen first so a reload swaps content in one step instead of flashing.
  const stage = document.createElement('div');
  stage.className = 'ov-content ov-stage';
  document.body.append(stage);
  try {
    const renderer = await loadRenderer(message.format);
    const rendered = await renderer.render(message.data, stage, {
      palette,
      locale: message.locale,
      strings: message.strings,
      previous: current?.state?.(),
      fragment: message.reload ? undefined : message.fragment,
      line: message.reload ? undefined : message.line,
    });
    if (id !== renderId) {
      rendered.dispose?.();
      return;
    }
    const scrollRatio = hasContent ? currentScrollRatio() : saved.scrollRatio;
    replaceCurrent(rendered);
    shell.content.replaceChildren(...stage.childNodes);
    hasContent = true;
    shell.setColors(
      darkTheme && rendered.adaptsColors !== false,
      message.colorMode === 'dark',
      message.strings,
    );
    shell.setZoomEnabled(true);
    zoom.setNaturalWidth(rendered.naturalWidth);
    restoreScroll(scrollRatio);
    const context: RenderContext = {
      viewport: shell.viewport,
      footer: shell.footer,
      tabBar: shell.tabBar,
      overlay: shell.overlay,
      getZoom: () => zoom.zoom,
      setBusy: (busy) => shell.setBusy(busy),
    };
    rendered.activate?.(context);
    diff.attach(rendered, context, message.strings);
    renderContext = context;
    if (!comparing) navigationOpen = message.navigationPane;
    showNavigation(message.strings);
  } catch (error) {
    console.error(error);
    if (id === renderId && !keepOnFailure) {
      const { errorDamaged, errorRender } = message.strings;
      showError(message, isDamaged(error) ? errorDamaged : errorRender);
    }
  } finally {
    stage.remove();
    if (id === renderId) {
      shell.setBusy(false);
    }
  }
}

/** Fills the navigation pane from the document on screen, or hides it. */
function showNavigation(strings: ViewerStrings): void {
  navigation?.dispose();
  navigation = undefined;
  shell.navigationBody.replaceChildren();
  if (navigationOpen && current && renderContext) {
    navigation = current.navigation?.(renderContext);
    if (navigation) shell.navigationBody.append(navigation.element);
  }
  shell.setNavigation(Boolean(current?.navigation), navigation?.title, strings);
}

function toggleNavigation(): void {
  if (!lastLoad || !hasContent || !current?.navigation) return;
  navigationOpen = !navigationOpen;
  // Opened beside a comparison, it is for this once; the choice for single files stays.
  if (!comparing) {
    lastLoad = { ...lastLoad, navigationPane: navigationOpen };
    vscode.postMessage({ type: 'setNavigationPane', open: navigationOpen });
  }
  showNavigation(lastLoad.strings);
}

function setComparing(value: boolean): void {
  if (value === comparing) return;
  comparing = value;
  navigationOpen = !comparing && Boolean(lastLoad?.navigationPane);
  if (lastLoad && hasContent) showNavigation(lastLoad.strings);
}

function toggleColors(): void {
  if (!lastLoad) {
    return;
  }
  const mode = lastLoad.colorMode === 'dark' ? 'original' : 'dark';
  lastLoad = { ...lastLoad, colorMode: mode };
  vscode.postMessage({ type: 'setColorMode', mode });
  rerender();
}

/** Renders the current document again in place, keeping zoom and scroll position. */
function rerender(): void {
  if (lastLoad && hasContent) {
    void show({ ...lastLoad, reload: true });
  }
}

function showReadError(message: ReadErrorMessage): void {
  shell.setDocument(message.fileName, message.format, message.canOpenInOffice, message.strings);
  showError(message, message.strings.errorRead);
}

function showError(message: LoadMessage | ReadErrorMessage, reason: string): void {
  hasContent = false;
  replaceCurrent(undefined);
  shell.setNavigation(false, undefined, message.strings);
  shell.showError(
    message.strings.errorTitle,
    reason,
    message.canOpenInOffice ? message.strings.openInOffice : undefined,
  );
}

/** Releases the previous document (its workers, listeners and footer) before showing another. */
function replaceCurrent(next: RenderedDocument | undefined): void {
  diff.detach();
  navigation?.dispose();
  navigation = undefined;
  shell.navigationBody.replaceChildren();
  renderContext = undefined;
  current?.dispose?.();
  current = next;
  shell.footer.replaceChildren();
  shell.footer.hidden = true;
  shell.tabBar.replaceChildren();
  shell.tabBar.hidden = true;
}

function currentThemeKey(): string {
  const palette = readPalette();
  const colors = palette
    ? `${formatCssColor(palette.background)} ${formatCssColor(palette.foreground)}`
    : '';
  return `${isDarkTheme()} ${colors}`;
}

function currentScrollRatio(): number {
  const { scrollTop, scrollHeight } = shell.viewport;
  return scrollHeight > 0 ? scrollTop / scrollHeight : 0;
}

function restoreScroll(ratio: number): void {
  shell.viewport.scrollTop = ratio * shell.viewport.scrollHeight;
}

function saveState(): void {
  vscode.setState({ zoom: fixedZoom, scrollRatio: hasContent ? currentScrollRatio() : 0 });
}

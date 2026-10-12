import './styles/viewer.css';
import { formatCssColor } from '../shared/color';
import { detectContainer } from '../shared/formats';
import type { HostToWebviewMessage, LoadMessage, ReadErrorMessage } from '../shared/protocol';
import { adaptDocumentColors, isDarkTheme, readPalette } from './darkColors';
import { loadRenderer } from './renderers';
import { Shell } from './shell';
import { vscode, type ViewState } from './vscodeApi';
import { ZoomController } from './zoomController';

const saved: ViewState = vscode.getState() ?? { zoom: null, scrollRatio: 0 };
let fixedZoom = saved.zoom;
let hasContent = false;
let renderId = 0;
/** The last document received, kept to re-render when colors or the theme change. */
let lastLoad: LoadMessage | undefined;
let themeKey = currentThemeKey();

const shell = new Shell(document.getElementById('app') as HTMLElement, {
  onZoomIn: () => zoom.zoomIn(),
  onZoomOut: () => zoom.zoomOut(),
  onResetZoom: () => zoom.reset(),
  onOpenInOffice: () => vscode.postMessage({ type: 'openInOffice' }),
  onToggleColors: toggleColors,
});
shell.setZoomEnabled(false);

const zoom = new ZoomController(
  {
    viewport: shell.viewport,
    content: shell.content,
    onChange: (value, fixed) => {
      fixedZoom = fixed;
      shell.setZoom(value);
      saveState();
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

async function show(message: LoadMessage): Promise<void> {
  const id = ++renderId;
  lastLoad = message;
  // A file caught mid-save can be incomplete; keep showing the last good render in that case.
  const keepOnFailure = message.reload && hasContent;
  shell.setDocument(message.fileName, message.format, message.canOpenInOffice, message.strings);

  const container = detectContainer(message.data);
  if (container !== 'zip') {
    if (!keepOnFailure) {
      const reason =
        container === 'cfb' ? message.strings.errorProtectedOrLegacy : message.strings.errorDamaged;
      showError(message, reason);
    }
    return;
  }

  const darkTheme = isDarkTheme();
  const palette = darkTheme && message.colorMode === 'dark' ? readPalette() : undefined;

  shell.setBusy(true);
  // Render off-screen first so a reload swaps content in one step instead of flashing.
  const stage = document.createElement('div');
  stage.className = 'ov-content ov-stage';
  document.body.append(stage);
  try {
    const renderer = await loadRenderer(message.format);
    const rendered = await renderer.render(message.data, stage);
    if (id !== renderId) {
      return;
    }
    if (palette) {
      adaptDocumentColors(stage, palette);
    }
    const scrollRatio = hasContent ? currentScrollRatio() : saved.scrollRatio;
    shell.content.replaceChildren(...stage.childNodes);
    hasContent = true;
    shell.setColors(darkTheme, message.colorMode === 'dark', message.strings);
    shell.setZoomEnabled(true);
    zoom.setNaturalWidth(rendered.naturalWidth);
    restoreScroll(scrollRatio);
  } catch (error) {
    console.error(error);
    if (id === renderId && !keepOnFailure) {
      showError(message, message.strings.errorRender);
    }
  } finally {
    stage.remove();
    if (id === renderId) {
      shell.setBusy(false);
    }
  }
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
  shell.showError(
    message.strings.errorTitle,
    reason,
    message.canOpenInOffice ? message.strings.openInOffice : undefined,
  );
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

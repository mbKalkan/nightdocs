// The content is scaled with CSS `zoom`. Browsers give the box of an element inside it on
// screen, but VS Code's desktop app turns that standard off (StandardizedBrowserZoom), and there
// `getBoundingClientRect()` gives it divided by the zoom.

let standard: boolean | undefined;

/** Whether `getBoundingClientRect()` inside zoomed content is in screen pixels. */
function standardZoom(): boolean {
  if (standard === undefined) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position: fixed; width: 10px; height: 10px; zoom: 2; visibility: hidden';
    document.body.append(probe);
    standard = probe.getBoundingClientRect().width > 15;
    probe.remove();
  }
  return standard;
}

/** Where `element` is on screen, as `getBoundingClientRect()` gives it in browsers. */
export function screenRect(element: Element): DOMRect {
  const rect = element.getBoundingClientRect();
  if (standardZoom()) return rect;
  let zoom = 1;
  for (let at: Element | null = element; at; at = at.parentElement) {
    if (at instanceof HTMLElement && at.style.zoom) zoom *= parseFloat(at.style.zoom) || 1;
  }
  if (zoom === 1) return rect;
  return new DOMRect(rect.x * zoom, rect.y * zoom, rect.width * zoom, rect.height * zoom);
}

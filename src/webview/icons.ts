// Inline 16px icons drawn with currentColor so they follow the VS Code theme.

const svg = (body: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  zoomIn: svg('<path d="M3.5 8h9M8 3.5v9"/>'),
  zoomOut: svg('<path d="M3.5 8h9"/>'),
  arrowUp: svg('<path d="M8 12.5v-9M4 7.5l4-4 4 4"/>'),
  arrowDown: svg('<path d="M8 3.5v9M4 8.5l4 4 4-4"/>'),
  chart: svg('<path d="M2.5 13.5h11M4.5 11.5V8M8 11.5V4.5M11.5 11.5V6.5"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  sidebar: svg('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/>'),
  chevronDown: svg('<path d="M3.5 6 8 10.5 12.5 6"/>'),
  notes: svg('<path d="M3.5 2.5h9v11h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h3"/>'),
  link: svg(
    '<path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5L8.5 4M9.5 6.5a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5l.5-.5"/>',
  ),
  comment: svg('<path d="M2.5 3h11v7.5h-6L5 13v-2.5H2.5z"/>'),
  eye: svg(
    '<path d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  ),
  chevronLeft: svg('<path d="M10 3.5 5.5 8l4.5 4.5"/>'),
  chevronRight: svg('<path d="M6 3.5 10.5 8 6 12.5"/>'),
  list: svg(
    '<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.75" cy="4" r=".75" fill="currentColor" stroke="none"/><circle cx="2.75" cy="8" r=".75" fill="currentColor" stroke="none"/><circle cx="2.75" cy="12" r=".75" fill="currentColor" stroke="none"/>',
  ),
  colors: svg(
    '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/>',
  ),
  openExternal: svg(
    '<path d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>',
  ),
  document: svg(
    '<path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5z"/><path d="M9.5 1.5V5H13M5.5 8h5M5.5 10.5h5"/>',
  ),
  error: svg(
    '<path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5z"/><path d="M9.5 1.5V5H13M6.25 8.25l3.5 3.5M9.75 8.25l-3.5 3.5"/>',
  ),
} as const;

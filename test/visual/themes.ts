// The subset of VS Code theme variables the viewer uses, taken from the default themes.

const font = {
  '--vscode-font-family': '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", sans-serif',
  '--vscode-font-size': '13px',
};

export const themes = {
  dark: {
    bodyClass: 'vscode-dark',
    variables: {
      ...font,
      '--vscode-editor-background': '#1f1f1f',
      '--vscode-foreground': '#cccccc',
      '--vscode-descriptionForeground': '#9d9d9d',
      '--vscode-icon-foreground': '#cccccc',
      '--vscode-panel-border': '#2b2b2b',
      '--vscode-widget-border': '#313131',
      '--vscode-toolbar-hoverBackground': 'rgba(90, 93, 94, 0.31)',
      '--vscode-toolbar-activeBackground': 'rgba(99, 102, 103, 0.31)',
      '--vscode-button-background': '#0078d4',
      '--vscode-button-foreground': '#ffffff',
      '--vscode-button-hoverBackground': '#026ec1',
      '--vscode-button-border': 'rgba(255, 255, 255, 0.07)',
      '--vscode-button-secondaryBackground': '#313131',
      '--vscode-button-secondaryForeground': '#cccccc',
      '--vscode-button-secondaryHoverBackground': '#3c3c3c',
      '--vscode-focusBorder': '#0078d4',
      '--vscode-progressBar-background': '#0078d4',
      '--vscode-charts-blue': '#3794ff',
    },
  },
  light: {
    bodyClass: 'vscode-light',
    variables: {
      ...font,
      '--vscode-editor-background': '#ffffff',
      '--vscode-foreground': '#3b3b3b',
      '--vscode-descriptionForeground': '#3b3b3b',
      '--vscode-icon-foreground': '#3b3b3b',
      '--vscode-panel-border': '#e5e5e5',
      '--vscode-widget-border': '#e5e5e5',
      '--vscode-toolbar-hoverBackground': 'rgba(184, 184, 184, 0.31)',
      '--vscode-toolbar-activeBackground': 'rgba(166, 166, 166, 0.31)',
      '--vscode-button-background': '#005fb8',
      '--vscode-button-foreground': '#ffffff',
      '--vscode-button-hoverBackground': '#0258a8',
      '--vscode-button-border': 'rgba(0, 0, 0, 0.1)',
      '--vscode-button-secondaryBackground': '#e5e5e5',
      '--vscode-button-secondaryForeground': '#3b3b3b',
      '--vscode-button-secondaryHoverBackground': '#cccccc',
      '--vscode-focusBorder': '#005fb8',
      '--vscode-progressBar-background': '#005fb8',
      '--vscode-charts-blue': '#1a85ff',
    },
  },
} as const;

export type ThemeName = keyof typeof themes;

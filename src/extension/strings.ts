import * as vscode from 'vscode';
import type { ViewerStrings } from '../shared/protocol';

export function viewerStrings(appName: string): ViewerStrings {
  return {
    zoomIn: vscode.l10n.t('Zoom In'),
    zoomOut: vscode.l10n.t('Zoom Out'),
    resetZoom: vscode.l10n.t('Reset Zoom'),
    showOriginalColors: vscode.l10n.t('Show Original Colors'),
    showDarkColors: vscode.l10n.t('Show Dark Colors'),
    openInOffice: vscode.l10n.t('Open in {0}', appName),
    openInOfficeTooltip: vscode.l10n.t('Open the file in its default desktop app to edit it'),
    loading: vscode.l10n.t('Loading…'),
    errorTitle: vscode.l10n.t("This document can't be displayed"),
    errorDamaged: vscode.l10n.t(
      "The file appears to be damaged or isn't a valid {0} document.",
      appName,
    ),
    errorProtectedOrLegacy: vscode.l10n.t(
      "The file is password-protected or uses an older binary format that isn't supported yet.",
    ),
    errorRender: vscode.l10n.t('Something went wrong while rendering this document.'),
    errorRead: vscode.l10n.t("The file couldn't be read."),
    errorEmpty: vscode.l10n.t('The file is empty.'),
    // Templates: the webview fills in {0}.
    statusCount: vscode.l10n.t('Count: {0}'),
    statusSum: vscode.l10n.t('Sum: {0}'),
    statusAverage: vscode.l10n.t('Average: {0}'),
    find: vscode.l10n.t('Find'),
    findNoResults: vscode.l10n.t('No results'),
    findCount: vscode.l10n.t('{0} of {1}'),
    findPrevious: vscode.l10n.t('Previous Match (Shift+Enter)'),
    findNext: vscode.l10n.t('Next Match (Enter)'),
    findClose: vscode.l10n.t('Close (Escape)'),
    chart: vscode.l10n.t('Chart'),
    chartHint: vscode.l10n.t('Open in {0} to see this chart', appName),
    sheets: vscode.l10n.t('Sheets'),
    allSheets: vscode.l10n.t('All Sheets'),
    scrollSheetsLeft: vscode.l10n.t('Scroll Sheet Tabs Left'),
    scrollSheetsRight: vscode.l10n.t('Scroll Sheet Tabs Right'),
    slide: vscode.l10n.t('Slide {0}'),
    slidePosition: vscode.l10n.t('Slide {0} of {1}'),
    hiddenSlide: vscode.l10n.t('Hidden slide'),
    noChanges: vscode.l10n.t('No changes'),
    oneChange: vscode.l10n.t('1 change'),
    changeCount: vscode.l10n.t('{0} changes'),
    changePosition: vscode.l10n.t('Change {0} of {1}'),
    previousChange: vscode.l10n.t('Previous Change'),
    nextChange: vscode.l10n.t('Next Change'),
  };
}

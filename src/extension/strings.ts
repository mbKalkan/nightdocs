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
  };
}

import * as vscode from 'vscode';
import type { SheetChoice } from '../shared/protocol';

interface SheetItem extends vscode.QuickPickItem {
  sheet: string;
}

/**
 * Lists a workbook's sheets in VS Code's quick pick, which filters as you type, and resolves
 * to the one picked, or undefined when the list is dismissed.
 */
export function pickSheet(sheets: readonly SheetChoice[]): Promise<string | undefined> {
  const items = sheets.map((sheet): SheetItem => ({
    label: sheet.name,
    sheet: sheet.name,
    description: [
      sheet.current ? vscode.l10n.t('current') : undefined,
      sheet.changed ? vscode.l10n.t('changed') : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
  }));
  const picker = vscode.window.createQuickPick<SheetItem>();
  picker.placeholder = vscode.l10n.t('Go to a sheet ({0} sheets)', sheets.length);
  picker.items = items;
  // Open on the current sheet, so the arrow keys go on from there.
  picker.activeItems = items.filter((_, i) => sheets[i].current);
  return new Promise((resolve) => {
    picker.onDidAccept(() => {
      resolve(picker.selectedItems[0]?.sheet);
      picker.hide();
    });
    picker.onDidHide(() => {
      resolve(undefined);
      picker.dispose();
    });
    picker.show();
  });
}

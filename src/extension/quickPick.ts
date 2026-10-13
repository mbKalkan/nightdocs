import * as vscode from 'vscode';
import type { PickItem } from '../shared/protocol';

/**
 * Lists items in VS Code's quick pick, which filters as you type, opened on the current one.
 * Resolves to the index of the item picked, or -1 when the list is dismissed.
 */
export function pick(placeholder: string, items: readonly PickItem[]): Promise<number> {
  const entries = items.map((item, index) => ({ ...item, index }));
  const picker = vscode.window.createQuickPick<(typeof entries)[number]>();
  picker.placeholder = placeholder;
  picker.items = entries;
  picker.activeItems = entries.filter((entry) => entry.current);
  return new Promise((resolve) => {
    picker.onDidAccept(() => {
      resolve(picker.selectedItems[0]?.index ?? -1);
      picker.hide();
    });
    picker.onDidHide(() => {
      resolve(-1);
      picker.dispose();
    });
    picker.show();
  });
}

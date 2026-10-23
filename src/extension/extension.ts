import type * as vscode from 'vscode';
import { renderComparisons } from './markdown';
import { ViewerProvider } from './viewerProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(ViewerProvider.register(context), renderComparisons());
}

export function deactivate(): void {}

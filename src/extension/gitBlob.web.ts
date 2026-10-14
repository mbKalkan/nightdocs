import type * as vscode from 'vscode';

/**
 * Stand-in for `gitBlob.ts` in the web bundle (see scripts/build.mjs). VS Code for the Web has
 * no git executable, and its repository file systems serve Office files as they are, so there
 * is no text-converted version to recover from.
 */
export async function readGitBlob(_uri: vscode.Uri): Promise<Uint8Array | undefined> {
  return undefined;
}

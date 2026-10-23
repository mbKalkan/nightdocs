import * as vscode from 'vscode';

/**
 * The scheme of a tab showing a Markdown comparison inline: one view of the modified version
 * with the changes from the original in it. Its path is the modified file's, so the tab is named
 * after it and the Markdown viewer opens it; the query says what is compared.
 */
export const INLINE_SCHEME = 'nightdocs-compare';

/** The versions a comparison shows, and its title (Git's "a.md (Working Tree)"). */
export interface InlineComparison {
  original: vscode.Uri;
  modified: vscode.Uri;
  label: string;
}

export function inlineUri({ original, modified, label }: InlineComparison): vscode.Uri {
  return modified.with({
    scheme: INLINE_SCHEME,
    query: JSON.stringify({ original: original.toString(), modified: modified.toString(), label }),
    fragment: '',
  });
}

export function parseInlineUri(uri: vscode.Uri): InlineComparison | undefined {
  if (uri.scheme !== INLINE_SCHEME) return undefined;
  try {
    const { original, modified, label } = JSON.parse(uri.query) as Record<string, unknown>;
    if (typeof original !== 'string' || typeof modified !== 'string') return undefined;
    return {
      original: vscode.Uri.parse(original),
      modified: vscode.Uri.parse(modified),
      label: typeof label === 'string' ? label : '',
    };
  } catch {
    return undefined;
  }
}

/** Identifies a comparison by its versions, whichever way it is shown. */
export const comparisonKey = ({
  original,
  modified,
}: {
  original: vscode.Uri;
  modified: vscode.Uri;
}) => `${original.toString()} ${modified.toString()}`;

const INLINE_KEY = 'nightdocs.markdown.inline';
let memento: vscode.Memento | undefined;

/** Where the choice between inline and side by side is kept, across sessions. */
export function keepLayoutIn(state: vscode.Memento): void {
  memento = state;
}

/**
 * Whether Markdown comparisons are shown inline: as the user last chose in the viewer, or else
 * as VS Code's own diff editor is set to (Diff Editor: Render Side By Side).
 */
export const prefersInline = () =>
  memento?.get<boolean>(INLINE_KEY) ??
  !vscode.workspace.getConfiguration('diffEditor').get<boolean>('renderSideBySide', true);

export function setPrefersInline(inline: boolean): void {
  void memento?.update(INLINE_KEY, inline);
}

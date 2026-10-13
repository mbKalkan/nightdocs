import type { PickItem } from '../shared/protocol';
import { vscode } from './vscodeApi';

let pending: ((index: number) => void) | undefined;

/**
 * Has VS Code list items to pick one from, in its quick pick. Resolves to the index of the
 * item picked, or undefined when the list is dismissed or another list replaces it.
 */
export function pick(placeholder: string, items: PickItem[]): Promise<number | undefined> {
  pending?.(-1);
  return new Promise((resolve) => {
    pending = (index) => {
      pending = undefined;
      resolve(index >= 0 && index < items.length ? index : undefined);
    };
    vscode.postMessage({ type: 'pick', placeholder, items });
  });
}

/** Hands over the answer to the last list asked for. */
export function picked(index: number): void {
  pending?.(index);
}

/** The description of a listed item: whether it is where the view is, and what else. */
export function describe(...parts: (string | false | undefined)[]): string | undefined {
  return parts.filter(Boolean).join(' · ') || undefined;
}

import type { ResourceMessage } from '../shared/protocol';
import { vscode } from './vscodeApi';

let nextId = 0;
const pending = new Map<number, (message: ResourceMessage) => void>();

/**
 * Asks the extension host for a file a document links to, such as a picture next to a Markdown
 * file; the webview can't read files itself.
 */
export function requestResource(href: string): Promise<ResourceMessage> {
  const id = ++nextId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    vscode.postMessage({ type: 'resource', id, href });
  });
}

/** Hands an answer from the host to whoever asked for it. */
export function resourceArrived(message: ResourceMessage): void {
  pending.get(message.id)?.(message);
  pending.delete(message.id);
}

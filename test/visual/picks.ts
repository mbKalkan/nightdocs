// Plays VS Code's part in the lists a viewer asks for: Go to Sheet, Slide and Heading.
import { expect } from '@playwright/test';
import type { PickItem } from '../../src/shared/protocol';
import type { openViewer } from './harness';

type Viewer = Awaited<ReturnType<typeof openViewer>>;

export interface PickRequest {
  placeholder: string;
  items: PickItem[];
}

const requests = async (viewer: Viewer) =>
  ((await viewer.sent()) as unknown as ({ type: string } & PickRequest)[]).filter(
    (message) => message.type === 'pick',
  );

/** The last list the viewer asked for, once it has asked for `count` of them. */
export async function lastPick(viewer: Viewer, count = 1): Promise<PickRequest> {
  await expect.poll(async () => (await requests(viewer)).length).toBeGreaterThanOrEqual(count);
  return (await requests(viewer)).pop()!;
}

/** Picks the item whose label, without its indent, is `label`. */
export async function answerPick(viewer: Viewer, request: PickRequest, label: string) {
  const index = request.items.findIndex((item) => item.label.trim() === label);
  expect(index, `"${label}" is listed`).toBeGreaterThanOrEqual(0);
  await viewer.post({ type: 'picked', index });
}

import workerSource from 'worker-source:xlsx';
import type { SheetData, WorkbookInfo } from './model';
import type { WorkerRequest, WorkerResponse } from './worker';

type Pending = { resolve(value: unknown): void; reject(error: Error): void };

/** Promise-based access to the parsing worker; one worker per open workbook. */
export class WorkbookClient {
  private readonly worker: Worker;
  private readonly url: string;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    this.worker = new Worker(this.url);
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      this.pending.delete(response.id);
      if (response.ok) pending?.resolve(response.result);
      else pending?.reject(new Error(response.error));
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      for (const pending of this.pending.values()) pending.reject(new Error(event.message));
      this.pending.clear();
    };
  }

  open(bytes: Uint8Array, locale: string): Promise<WorkbookInfo> {
    // Send a copy: the caller keeps its bytes for re-rendering.
    const copy = bytes.slice();
    return this.request({ type: 'open', bytes: copy, locale }, [
      copy.buffer,
    ]) as Promise<WorkbookInfo>;
  }

  sheet(index: number): Promise<SheetData> {
    return this.request({ type: 'sheet', index }) as Promise<SheetData>;
  }

  dispose(): void {
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
    for (const pending of this.pending.values()) pending.reject(new Error('Workbook closed'));
    this.pending.clear();
  }

  private request(message: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

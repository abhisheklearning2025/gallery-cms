import type { CompressResult, WorkerRequest, WorkerResponse } from './types';
import { compressVideo } from './video';

/**
 * Two-worker compression pool (§2.7). Images go to the workers; video runs on
 * the main thread (see video.ts) but is serialised through the same queue so a
 * video encode never competes with two image encodes for cores.
 */

const MAX_WORKERS = 2;

interface Job {
  id: string;
  file: File;
  kind: 'image' | 'video';
  onProgress: (pct: number, note?: string) => void;
  resolve: (r: CompressResult) => void;
  reject: (e: Error) => void;
}

class Pool {
  private queue: Job[] = [];
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private active = new Map<Worker, Job>();
  private videoBusy = false;

  private spawn(): Worker | null {
    if (this.workers.length >= MAX_WORKERS) return null;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return null; // No worker support — the caller falls back to inline work.
    }

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const job = this.active.get(worker);
      if (!job || e.data.id !== job.id) return;
      const msg = e.data;

      if (msg.type === 'progress') {
        job.onProgress(msg.pct, msg.note);
        return;
      }
      this.active.delete(worker);
      this.idle.push(worker);
      if (msg.type === 'done') job.resolve(msg.result);
      else job.reject(new Error(msg.message));
      this.drain();
    };

    worker.onerror = () => {
      const job = this.active.get(worker);
      this.active.delete(worker);
      if (job) job.reject(new Error('The compression worker crashed. Try a smaller file.'));
      this.drain();
    };

    this.workers.push(worker);
    return worker;
  }

  run(
    file: File,
    kind: 'image' | 'video',
    onProgress: (pct: number, note?: string) => void,
  ): Promise<CompressResult> {
    return new Promise<CompressResult>((resolve, reject) => {
      this.queue.push({
        id: crypto.randomUUID(),
        file,
        kind,
        onProgress,
        resolve,
        reject,
      });
      this.drain();
    });
  }

  private drain() {
    // Videos first: they're the slow item, and starting one early means it
    // overlaps with the image work rather than trailing it.
    const videoIdx = this.queue.findIndex((j) => j.kind === 'video');
    if (videoIdx >= 0 && !this.videoBusy) {
      const [job] = this.queue.splice(videoIdx, 1);
      this.videoBusy = true;
      compressVideo(job.file, job.onProgress)
        .then(job.resolve, (e: unknown) =>
          job.reject(e instanceof Error ? e : new Error('Video compression failed.')),
        )
        .finally(() => {
          this.videoBusy = false;
          this.drain();
        });
    }

    while (this.queue.some((j) => j.kind === 'image')) {
      const worker = this.idle.pop() ?? this.spawn();
      if (!worker) break;

      const idx = this.queue.findIndex((j) => j.kind === 'image');
      const job = this.queue.splice(idx, 1)[0];
      this.active.set(worker, job);
      const req: WorkerRequest = { id: job.id, file: job.file, kind: job.kind };
      worker.postMessage(req);
    }
  }

  terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.active.clear();
    this.queue = [];
  }
}

let pool: Pool | null = null;

export function compressionPool(): Pool {
  pool ??= new Pool();
  return pool;
}

export function terminatePool() {
  pool?.terminate();
  pool = null;
}

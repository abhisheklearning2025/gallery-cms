/// <reference lib="webworker" />
import { compressImage } from './image';
import type { WorkerRequest, WorkerResponse } from './types';

/**
 * Image compression worker. Two of these run at most (see pool.ts) — compression
 * is CPU-bound, so more workers than that just fight over cores and make the
 * progress bars lie.
 *
 * Video does not run here: decoding needs an HTMLVideoElement, which a worker
 * doesn't have. See video.ts for why that's fine.
 */
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, file } = e.data;
  const post = (msg: WorkerResponse) => self.postMessage(msg);

  try {
    const result = await compressImage(file, (pct, note) => {
      post({ id, type: 'progress', pct, note });
    });
    post({ id, type: 'done', result });
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : 'Compression failed.' });
  }
};

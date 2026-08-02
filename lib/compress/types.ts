import type { CompressedBy, MediaKind, RenditionName } from '../types';

export interface CompressedRendition {
  name: RenditionName;
  blob: Blob;
  bytes: number;
  contentType: string;
}

export interface CompressResult {
  kind: MediaKind;
  renditions: CompressedRendition[];
  width: number;
  height: number;
  durationS?: number;
  lqip?: string;
  compressedBy: CompressedBy;
  sourceBytes: number;
  /** Human-readable note shown in the upload row, e.g. "HEIC → WebP". */
  note?: string;
}

export type UploadPhase =
  | 'queued'
  | 'validating'
  | 'compressing'
  | 'uploading'
  | 'ready'
  | 'failed';

export interface ProgressUpdate {
  phase: UploadPhase;
  /** 0–100 within the current phase. */
  pct: number;
  note?: string;
}

export type ProgressFn = (u: ProgressUpdate) => void;

/** Messages across the worker boundary. */
export type WorkerRequest = {
  id: string;
  file: File;
  kind: MediaKind;
};

export type WorkerResponse =
  | { id: string; type: 'progress'; pct: number; note?: string }
  | { id: string; type: 'done'; result: CompressResult }
  | { id: string; type: 'error'; message: string };

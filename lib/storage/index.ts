/**
 * Storage adapter. Every object-store call in the codebase goes through this
 * module — there are no S3 imports anywhere else. Swapping providers is one
 * env var (STORAGE_DRIVER), not a refactor.
 */
import { storageDriver } from '../env';
import type { RenditionName } from '../types';

export interface SignedUpload {
  url: string;
  key: string;
  /** Headers the browser MUST send on the PUT for the signature to validate. */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface HeadResult {
  exists: boolean;
  bytes: number;
  contentType?: string;
}

export interface StorageAdapter {
  readonly name: string;
  put(key: string, body: Uint8Array | Buffer, contentType: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  getPublicUrl(key: string): string;
  /**
   * Presigned PUT for an already-compressed rendition. `bytes` is bound into
   * the signature as a Content-Length condition so a client cannot declare a
   * small size and then upload a large file (§4, /api/upload/sign).
   */
  getSignedUploadUrl(args: {
    key: string;
    contentType: string;
    bytes: number;
    expiresInSeconds?: number;
  }): Promise<SignedUpload>;
  head(key: string): Promise<HeadResult>;
  list(prefix: string): Promise<{ key: string; bytes: number; lastModified?: Date }[]>;
}

let cached: StorageAdapter | null = null;

export async function storage(): Promise<StorageAdapter> {
  if (cached) return cached;
  if (storageDriver() === 'supabase') {
    const { supabaseStorage } = await import('./supabase');
    cached = supabaseStorage();
  } else {
    const { r2Storage } = await import('./r2');
    cached = r2Storage();
  }
  return cached;
}

/** Bucket layout, §2.7: `g/{galleryId}/{mediaId}/{rendition}.{ext}`. */
export function objectKey(
  galleryId: string,
  mediaId: string,
  rendition: RenditionName,
  ext: string,
): string {
  return `g/${galleryId}/${mediaId}/${rendition}.${ext.replace(/^\./, '')}`;
}

export function extForContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/avif': 'avif',
    'image/png': 'png',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  return map[contentType] ?? 'bin';
}

import { compressionPool } from './pool';
import { preflight } from './preflight';
import { webCodecsAvailable } from './video';
import { formatSavings } from '../limits';
import type { CompressResult, ProgressFn } from './types';
import type { SizeKey } from '../limits';

/**
 * One file, end to end (§2.7):
 *
 *   validate → compress in the browser → verify under cap → presigned PUT of
 *   the COMPRESSED renditions only → server verifies stored bytes → ready
 *
 * The original never leaves the device on this path. The only exception is the
 * explicit fallback for browsers that can't compress locally, which stages the
 * original under `tmp/` and deletes it the moment the server has finished.
 */

export interface UploadOutcome {
  mediaId: string;
  bytes: number;
  sourceBytes: number;
  savings: string;
  compressedBy: string;
  kind: 'image' | 'video';
}

export async function uploadOne(
  file: File,
  galleryId: string,
  onProgress: ProgressFn,
  opts: { alt?: string; tag?: string; size?: SizeKey } = {},
): Promise<UploadOutcome> {
  onProgress({ phase: 'validating', pct: 0 });

  const pre = await preflight(file);
  if (!pre.ok || !pre.kind) throw new Error(pre.errors[0] ?? 'That file can’t be used.');

  // Images need OffscreenCanvas; video needs either WebCodecs or ffmpeg.wasm,
  // and ffmpeg.wasm needs SharedArrayBuffer (which needs the COOP/COEP headers
  // next.config.ts sets on /admin). If none of that is available, the server
  // does the work instead.
  const canCompressLocally =
    pre.kind === 'image'
      ? typeof OffscreenCanvas !== 'undefined'
      : webCodecsAvailable() || typeof SharedArrayBuffer !== 'undefined';

  if (!canCompressLocally) {
    return uploadViaServer(file, galleryId, pre.kind, onProgress, opts);
  }

  onProgress({ phase: 'compressing', pct: 0 });

  let result: CompressResult;
  try {
    result = await compressionPool().run(file, pre.kind, (pct, note) =>
      onProgress({ phase: 'compressing', pct, note }),
    );
  } catch (err) {
    // A cap breach is a real rejection with an actionable message — surface it.
    // Anything else (a codec the browser can't handle, a crashed worker) is
    // worth one attempt on the server before giving up on the file.
    const message = err instanceof Error ? err.message : String(err);
    if (/after (two|three) compression passes|over the|Trim it/.test(message)) throw err;

    onProgress({ phase: 'compressing', pct: 0, note: 'retrying on the server' });
    return uploadViaServer(file, galleryId, pre.kind, onProgress, opts);
  }

  onProgress({
    phase: 'uploading',
    pct: 0,
    note: formatSavings(file.size, totalBytes(result)),
  });

  // ── sign ──────────────────────────────────────────────────────────────────
  const signRes = await fetch('/api/upload/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      galleryId,
      kind: result.kind,
      sourceBytes: file.size,
      compressedBy: result.compressedBy,
      width: result.width,
      height: result.height,
      durationS: result.durationS,
      lqip: result.lqip?.slice(0, 4000),
      renditions: result.renditions.map((r) => ({
        name: r.name,
        bytes: r.bytes,
        contentType: r.contentType,
      })),
    }),
  });

  if (!signRes.ok) throw new Error(await errorFrom(signRes));
  const signed = (await signRes.json()) as {
    mediaId: string;
    uploads: { name: string; key: string; url: string; headers: Record<string, string>; bytes: number }[];
  };

  // ── PUT each rendition straight to storage ────────────────────────────────
  let done = 0;
  for (const up of signed.uploads) {
    const rendition = result.renditions.find((r) => r.name === up.name);
    if (!rendition) continue;
    await putWithProgress(up.url, up.headers, rendition.blob, (pct) => {
      onProgress({
        phase: 'uploading',
        pct: Math.round(((done + pct / 100) / signed.uploads.length) * 100),
        note: formatSavings(file.size, totalBytes(result)),
      });
    });
    done++;
  }

  // ── commit: the server checks the ACTUAL stored bytes ────────────────────
  const commitRes = await fetch('/api/media/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaId: signed.mediaId,
      galleryId,
      keys: signed.uploads.map((u) => ({
        name: u.name,
        key: u.key,
        declaredBytes: u.bytes,
      })),
      alt: opts.alt ?? defaultAltFrom(file),
      tag: opts.tag,
      size: opts.size,
    }),
  });

  if (!commitRes.ok) throw new Error(await errorFrom(commitRes));
  const commit = (await commitRes.json()) as { mediaId: string; bytes: number };

  const savings = formatSavings(file.size, commit.bytes);
  onProgress({ phase: 'ready', pct: 100, note: savings });

  return {
    mediaId: commit.mediaId,
    bytes: commit.bytes,
    sourceBytes: file.size,
    savings,
    compressedBy: result.compressedBy,
    kind: result.kind,
  };
}

/** Fallback: stage the original, let the server compress, delete the original. */
async function uploadViaServer(
  file: File,
  galleryId: string,
  kind: 'image' | 'video',
  onProgress: ProgressFn,
  opts: { alt?: string; tag?: string },
): Promise<UploadOutcome> {
  onProgress({ phase: 'uploading', pct: 0, note: 'this browser can’t compress locally' });

  const signRes = await fetch('/api/upload/sign-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      galleryId,
      kind,
      bytes: file.size,
      contentType: file.type || (kind === 'image' ? 'image/jpeg' : 'video/mp4'),
    }),
  });
  if (!signRes.ok) throw new Error(await errorFrom(signRes));
  const signed = (await signRes.json()) as {
    url: string;
    key: string;
    headers: Record<string, string>;
  };

  await putWithProgress(signed.url, signed.headers, file, (pct) =>
    onProgress({ phase: 'uploading', pct, note: 'staging original for server-side compression' }),
  );

  onProgress({ phase: 'compressing', pct: 5, note: 'compressing on the server' });

  const res = await fetch('/api/media/process-fallback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      galleryId,
      kind,
      sourceKey: signed.key,
      sourceBytes: file.size,
      alt: opts.alt ?? defaultAltFrom(file),
      tag: opts.tag,
    }),
  });
  if (!res.ok) throw new Error(await errorFrom(res));
  const { mediaId } = (await res.json()) as { mediaId: string };

  const final = await pollUntilReady(mediaId, (pct) =>
    onProgress({ phase: 'compressing', pct, note: 'compressing on the server' }),
  );

  const savings = formatSavings(file.size, final.bytes);
  onProgress({ phase: 'ready', pct: 100, note: savings });

  return {
    mediaId,
    bytes: final.bytes,
    sourceBytes: file.size,
    savings,
    compressedBy: 'server',
    kind,
  };
}

async function pollUntilReady(mediaId: string, onTick: (pct: number) => void) {
  const started = Date.now();
  for (let i = 0; ; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`/api/media/${mediaId}/status`);
    if (res.ok) {
      const row = (await res.json()) as { status: string; bytes: number; error?: string };
      if (row.status === 'ready') return row;
      if (row.status === 'failed') throw new Error(row.error ?? 'Server-side compression failed.');
    } else if (res.status === 404) {
      throw new Error('Server-side compression failed and the item was cleaned up.');
    }
    onTick(Math.min(95, 5 + i * 4));
    if (Date.now() - started > 5 * 60_000) {
      throw new Error('Server-side compression timed out after 5 minutes.');
    }
  }
}

/**
 * XHR rather than fetch, purely because fetch still can't report upload
 * progress in any shipping browser.
 */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    for (const [k, v] of Object.entries(headers)) {
      // The browser sets Content-Length itself and forbids setting it here.
      if (k.toLowerCase() === 'content-length') continue;
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 0)
        reject(
          new Error(
            'The upload was blocked by CORS. Add this origin to the bucket’s CORS policy — see SETUP-TASKS.md, Task 2 step 7.',
          ),
        );
      else reject(new Error(`Storage rejected the upload (${xhr.status}).`));
    };
    xhr.onerror = () =>
      reject(
        new Error(
          'The upload couldn’t reach storage. Check the bucket’s CORS policy and your connection.',
        ),
      );
    xhr.send(body);
  });
}

function totalBytes(r: CompressResult): number {
  return r.renditions.reduce((n, x) => n + x.bytes, 0);
}

/** Seeds alt text from the filename so an image is never blocked on it (§7). */
function defaultAltFrom(file: File): string {
  const name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return name.length > 2 ? name.slice(0, 120) : 'Photo';
}

async function errorFrom(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Request failed (${res.status}).`;
}

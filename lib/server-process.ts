import 'server-only';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { storage, objectKey, extForContentType } from './storage';
import { supabaseAdmin } from './supabase/admin';
import {
  IMAGE_RENDITIONS,
  IMAGE_LADDER,
  VIDEO_RENDITIONS,
  VIDEO_LADDER,
  MAX_ITEM_BYTES,
  formatBytes,
} from './limits';
import type { RenditionName } from './types';

/**
 * Server-side fallback compression (§2.7). This is NOT the normal path — the
 * browser compresses first, and this only runs for browsers without WebCodecs
 * or for formats the browser can't decode.
 *
 * FREE-TIER NOTE: the video branch needs a real ffmpeg binary. That works
 * locally and on any Node 24 host, but @ffmpeg-installer/ffmpeg is ~80 MB and
 * will not fit inside Vercel Hobby's 250 MB serverless bundle — it is marked
 * external in next.config.ts and the route reports a clear error rather than
 * failing opaquely if the binary isn't there. On Vercel, the browser path
 * (WebCodecs, then ffmpeg.wasm) is what actually runs.
 */

export interface ProcessedRendition {
  name: RenditionName;
  key: string;
  bytes: number;
  contentType: string;
}

export interface ProcessResult {
  renditions: ProcessedRendition[];
  width: number;
  height: number;
  durationS?: number;
  lqip?: string;
  compressedBy: 'server-sharp' | 'server-ffmpeg';
}

async function download(key: string): Promise<Buffer> {
  const store = await storage();
  const url = store.getPublicUrl(key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read the staged upload back (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

// ── images ──────────────────────────────────────────────────────────────────

export async function processImageOnServer(
  galleryId: string,
  mediaId: string,
  sourceKey: string,
): Promise<ProcessResult> {
  const { default: sharp } = await import('sharp');
  const input = await download(sourceKey);

  const meta = await sharp(input).metadata();

  // metadata() reports the dimensions as stored on the sensor, BEFORE the EXIF
  // orientation flag is applied -- and the renditions below are built through
  // .rotate(), which does apply it. For orientations 5-8 (the 90 degree ones,
  // i.e. every portrait frame off a DSLR or phone) the rendered image is the
  // transpose of what metadata reports, so recording meta.width/height verbatim
  // stores a landscape shape for a portrait photo. The wall then builds a
  // landscape tile around it and object-fit:cover throws most of the frame away.
  const transposed = (meta.orientation ?? 1) >= 5;
  const width = (transposed ? meta.height : meta.width) ?? 0;
  const height = (transposed ? meta.width : meta.height) ?? 0;
  if (!width || !height) throw new Error('That file could not be decoded as an image.');

  const base = sharp(input, { failOn: 'none' })
    .rotate() // auto-orient from EXIF, then strip everything else
    .withMetadata({ orientation: undefined });

  // grid: 1200px WebP q75
  const grid = await base
    .clone()
    .resize({ width: IMAGE_RENDITIONS.grid.longEdge, height: IMAGE_RENDITIONS.grid.longEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: IMAGE_RENDITIONS.grid.quality })
    .toBuffer();

  if (grid.byteLength > IMAGE_RENDITIONS.grid.hardMax) {
    throw new Error(
      `The grid rendition came out at ${formatBytes(grid.byteLength)}, over the ${formatBytes(IMAGE_RENDITIONS.grid.hardMax)} limit.`,
    );
  }

  // full: adaptive ladder q82 → q72 → q62@1800 (§2.7)
  let full: Buffer | null = null;
  let usedStep = IMAGE_LADDER[0];
  for (const step of IMAGE_LADDER) {
    const attempt = await base
      .clone()
      .resize({ width: step.longEdge, height: step.longEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: step.quality })
      .toBuffer();
    usedStep = step;
    if (attempt.byteLength <= IMAGE_RENDITIONS.full.hardMax) {
      full = attempt;
      break;
    }
    full = attempt;
  }
  if (!full || full.byteLength > IMAGE_RENDITIONS.full.hardMax) {
    throw new Error(
      `This photo is still ${formatBytes(full?.byteLength ?? 0)} after three compression passes ` +
        `(down to quality ${usedStep.quality} at ${usedStep.longEdge}px). It's unusually detailed — ` +
        `try exporting it at a smaller size first.`,
    );
  }

  // JPEG fallback for the grid rendition, for clients without WebP.
  const fallback = await base
    .clone()
    .resize({ width: IMAGE_RENDITIONS.grid.longEdge, height: IMAGE_RENDITIONS.grid.longEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: IMAGE_RENDITIONS.grid.quality, mozjpeg: true })
    .toBuffer();

  // LQIP: a 20px WebP inlined as a data URI (§6.7).
  const lqipBuf = await base.clone().resize({ width: 20 }).webp({ quality: 40 }).toBuffer();
  const lqip = `data:image/webp;base64,${lqipBuf.toString('base64')}`;

  const store = await storage();
  const out: ProcessedRendition[] = [];

  for (const [name, buf, ct] of [
    ['grid', grid, 'image/webp'],
    ['full', full, 'image/webp'],
    ['fallback', fallback, 'image/jpeg'],
  ] as const) {
    const key = objectKey(galleryId, mediaId, name, extForContentType(ct));
    await store.put(key, buf, ct);
    out.push({ name, key, bytes: buf.byteLength, contentType: ct });
  }

  const total = out.reduce((n, r) => n + r.bytes, 0);
  if (total > MAX_ITEM_BYTES) {
    await store.remove(out.map((r) => r.key));
    throw new Error(`All renditions together came to ${formatBytes(total)}, over the per-item ceiling.`);
  }

  return { renditions: out, width, height, lqip, compressedBy: 'server-sharp' };
}

// ── video ───────────────────────────────────────────────────────────────────

export async function processVideoOnServer(
  galleryId: string,
  mediaId: string,
  sourceKey: string,
): Promise<ProcessResult> {
  const ffmpegPath = await resolveFfmpeg();
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  ffmpeg.setFfmpegPath(ffmpegPath);

  const dir = tmpdir();
  const id = randomUUID();
  const src = join(dir, `${id}-src`);
  const posterPath = join(dir, `${id}-poster.jpg`);
  const loopPath = join(dir, `${id}-loop.mp4`);
  const fullPath = join(dir, `${id}-full.mp4`);
  const cleanup = [src, posterPath, loopPath, fullPath];

  try {
    await writeFile(src, await download(sourceKey));

    const probe = await new Promise<{ width: number; height: number; duration: number }>(
      (resolve, reject) => {
        ffmpeg.ffprobe(src, (err, data) => {
          if (err) return reject(new Error('That video could not be read.'));
          const stream = data.streams.find((s) => s.codec_type === 'video');
          resolve({
            width: stream?.width ?? 0,
            height: stream?.height ?? 0,
            duration: Number(data.format.duration ?? 0),
          });
        });
      },
    );

    // poster: JPEG frame at 1s
    await run(ffmpeg(src).seekInput(Math.min(1, probe.duration / 2)).frames(1).size('?x1200').outputOptions('-q:v 4').output(posterPath));

    // loop: 720p, CRF 26, no audio, ≤12s (§2.6)
    await run(
      ffmpeg(src)
        .duration(VIDEO_RENDITIONS.loop.maxDurationS)
        .noAudio()
        .videoCodec('libx264')
        .outputOptions([
          '-crf 26',
          '-preset slow',
          '-pix_fmt yuv420p',
          '-movflags +faststart',
          `-vf scale=-2:'min(${VIDEO_RENDITIONS.loop.maxHeight},ih)'`,
          '-profile:v high',
        ])
        .output(loopPath),
    );

    // full: adaptive ladder CRF 22@1080 → 26@1080 → 28@720 (§2.7)
    let fullBytes = 0;
    let usedLabel = '';
    for (const step of VIDEO_LADDER) {
      await run(
        ffmpeg(src)
          .videoCodec('libx264')
          .audioCodec('aac')
          .audioBitrate('128k')
          .outputOptions([
            `-crf ${step.crf}`,
            '-preset medium',
            '-pix_fmt yuv420p',
            '-movflags +faststart',
            `-vf scale=-2:'min(${step.maxHeight},ih)'`,
          ])
          .output(fullPath),
      );
      fullBytes = (await stat(fullPath)).size;
      usedLabel = step.label;
      if (fullBytes <= VIDEO_RENDITIONS.full.hardMax) break;
    }

    if (fullBytes > VIDEO_RENDITIONS.full.hardMax) {
      throw new Error(
        `This clip is still ${formatBytes(fullBytes)} after three compression passes (down to ${usedLabel}) — ` +
          `it's ${Math.round(probe.duration)}s long. Trim it to under 30s and try again.`,
      );
    }

    const loopBytes = (await stat(loopPath)).size;
    if (loopBytes > VIDEO_RENDITIONS.loop.hardMax) {
      throw new Error(
        `The looping grid version came out at ${formatBytes(loopBytes)}, over the ${formatBytes(VIDEO_RENDITIONS.loop.hardMax)} limit. ` +
          `Busy, high-motion footage compresses badly — a shorter or steadier clip will work.`,
      );
    }

    const store = await storage();
    const out: ProcessedRendition[] = [];

    for (const [name, path, ct] of [
      ['poster', posterPath, 'image/jpeg'],
      ['grid', loopPath, 'video/mp4'],
      ['full', fullPath, 'video/mp4'],
    ] as const) {
      const buf = await readFile(path);
      const key = objectKey(galleryId, mediaId, name, extForContentType(ct));
      await store.put(key, buf, ct);
      out.push({ name, key, bytes: buf.byteLength, contentType: ct });
    }

    return {
      renditions: out,
      width: probe.width,
      height: probe.height,
      durationS: probe.duration,
      compressedBy: 'server-ffmpeg',
    };
  } finally {
    await Promise.all(cleanup.map((p) => unlink(p).catch(() => {})));
  }
}

function run(cmd: import('fluent-ffmpeg').FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`ffmpeg failed: ${err.message}`)))
      .run();
  });
}

async function resolveFfmpeg(): Promise<string> {
  try {
    const installer = (await import('@ffmpeg-installer/ffmpeg')) as unknown as { path: string };
    return installer.path;
  } catch {
    throw new Error(
      'No ffmpeg binary is available in this deployment, so server-side video processing is off. ' +
        'Use a browser with WebCodecs (Chrome, Edge, or Safari 17+), or run the app on a host that allows a ~80 MB binary.',
    );
  }
}

export async function markFailed(mediaId: string, message: string) {
  await supabaseAdmin().from('media_items').update({ status: 'failed', error: message }).eq('id', mediaId);
}

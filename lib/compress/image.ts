import { IMAGE_RENDITIONS, IMAGE_LADDER, formatBytes } from '../limits';
import type { CompressResult, CompressedRendition } from './types';

/**
 * Image compression, in the browser (§2.7).
 *
 *   HEIC?  → heic-to → Blob
 *   decode → createImageBitmap
 *   encode → OffscreenCanvas → WebP (+ JPEG fallback + 20px LQIP)
 *
 * Runs inside a Web Worker, so a 40-photo drop doesn't freeze the admin UI.
 * The `full` rendition walks the adaptive ladder q82 → q72 → q62@1800 rather
 * than failing on the first over-cap output.
 */

type Report = (pct: number, note?: string) => void;

export async function compressImage(
  file: File,
  report: Report = () => {},
): Promise<CompressResult> {
  let source: Blob = file;
  let note: string | undefined;

  if (isHeic(file)) {
    report(2, 'converting HEIC');
    // Chrome's <canvas> cannot decode HEIC at all, so this has to happen first.
    const { heicTo } = await import('heic-to');
    try {
      source = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
      note = 'HEIC → WebP';
    } catch {
      throw new Error(
        `${file.name} is a HEIC file that couldn't be converted. Re-export it as JPEG from Photos ` +
          `(Share → Options → Most Compatible) and try again.`,
      );
    }
  }

  report(12, 'decoding');
  const bitmap = await createImageBitmap(source).catch(() => null);
  if (!bitmap) {
    throw new Error(`${file.name} couldn't be decoded. It may be corrupt or an unsupported format.`);
  }

  const { width, height } = bitmap;
  if (Math.max(width, height) < 800) {
    note = note ? `${note} · small source` : 'small source';
  }

  try {
    // ── grid: 1200px WebP q75 ────────────────────────────────────────────────
    report(25, 'encoding grid');
    const grid = await encode(bitmap, IMAGE_RENDITIONS.grid.longEdge, {
      type: 'image/webp',
      quality: IMAGE_RENDITIONS.grid.quality / 100,
    });

    if (grid.size > IMAGE_RENDITIONS.grid.hardMax) {
      // The grid rendition has its own (small) ladder — one step down is enough
      // at 1200px; anything that still misses is genuinely pathological.
      const retry = await encode(bitmap, IMAGE_RENDITIONS.grid.longEdge, {
        type: 'image/webp',
        quality: 0.6,
      });
      if (retry.size > IMAGE_RENDITIONS.grid.hardMax) {
        throw new Error(
          `${file.name}'s grid rendition is still ${formatBytes(retry.size)} after two passes ` +
            `(cap ${formatBytes(IMAGE_RENDITIONS.grid.hardMax)}). Very noisy or heavily textured photos do this — ` +
            `try exporting it at a lower quality first.`,
        );
      }
      grid.blob = retry.blob;
      grid.size = retry.size;
    }

    // ── full: adaptive ladder ────────────────────────────────────────────────
    let full = grid;
    let usedStep = IMAGE_LADDER[0];
    for (const [i, step] of IMAGE_LADDER.entries()) {
      report(45 + i * 12, `encoding full (pass ${i + 1})`);
      const attempt = await encode(bitmap, step.longEdge, {
        type: 'image/webp',
        quality: step.quality / 100,
      });
      full = attempt;
      usedStep = step;
      if (attempt.size <= IMAGE_RENDITIONS.full.hardMax) break;
    }

    if (full.size > IMAGE_RENDITIONS.full.hardMax) {
      throw new Error(
        `${file.name} is still ${formatBytes(full.size)} after three compression passes ` +
          `(down to quality ${usedStep.quality} at ${usedStep.longEdge}px; the cap is ` +
          `${formatBytes(IMAGE_RENDITIONS.full.hardMax)}). Export it at a smaller size and try again.`,
      );
    }

    // ── JPEG fallback + LQIP ────────────────────────────────────────────────
    report(84, 'fallback + placeholder');
    const fallback = await encode(bitmap, IMAGE_RENDITIONS.grid.longEdge, {
      type: 'image/jpeg',
      quality: IMAGE_RENDITIONS.grid.quality / 100,
    });
    const lqip = await makeLqip(bitmap);

    report(100, 'done');

    const renditions: CompressedRendition[] = [
      { name: 'grid', blob: grid.blob, bytes: grid.size, contentType: 'image/webp' },
      { name: 'full', blob: full.blob, bytes: full.size, contentType: 'image/webp' },
      { name: 'fallback', blob: fallback.blob, bytes: fallback.size, contentType: 'image/jpeg' },
    ];

    return {
      kind: 'image',
      renditions,
      width,
      height,
      lqip,
      compressedBy: 'canvas',
      sourceBytes: file.size,
      note,
    };
  } finally {
    bitmap.close();
  }
}

function isHeic(file: File): boolean {
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

interface Encoded {
  blob: Blob;
  size: number;
}

async function encode(
  bitmap: ImageBitmap,
  longEdge: number,
  opts: { type: string; quality: number },
): Promise<Encoded> {
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('This browser blocked canvas access, so images can’t be compressed.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await canvas.convertToBlob(opts);
  return { blob, size: blob.size };
}

/** ~20px WebP as a data URI — painted as the tile background before load (§6.7). */
async function makeLqip(bitmap: ImageBitmap): Promise<string> {
  const { blob } = await encode(bitmap, 20, { type: 'image/webp', quality: 0.4 });
  const buf = await blob.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:image/webp;base64,${btoa(bin)}`;
}

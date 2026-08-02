import { PREFLIGHT, formatBytes } from '../limits';
import type { MediaKind } from '../types';

export interface PreflightResult {
  ok: boolean;
  kind: MediaKind | null;
  errors: string[];
  warnings: string[];
  width?: number;
  height?: number;
  durationS?: number;
  isHeic?: boolean;
}

const HEIC_EXT = /\.(heic|heif)$/i;

export function looksLikeHeic(file: File): boolean {
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    // iOS sometimes hands over an empty type; the extension is all we get.
    ((file.type === '' || file.type === 'application/octet-stream') && HEIC_EXT.test(file.name))
  );
}

export function kindOf(file: File): MediaKind | null {
  if (looksLikeHeic(file)) return 'image';
  if (PREFLIGHT.imageTypes.includes(file.type as never)) return 'image';
  if (PREFLIGHT.videoTypes.includes(file.type as never)) return 'video';
  if (/\.mov$/i.test(file.name)) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

/**
 * Client-side pre-flight (§2.7). Instant, before a byte of compression work.
 * Everything here is *also* enforced server-side — this is UX, not the limit.
 */
export async function preflight(file: File): Promise<PreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const kind = kindOf(file);

  if (!kind) {
    return {
      ok: false,
      kind: null,
      errors: [
        `${file.name} is a ${file.type || 'unrecognised'} file. Photos: JPEG, PNG, WebP, AVIF, HEIC. Video: MP4, MOV, WebM.`,
      ],
      warnings,
    };
  }

  const cap = kind === 'image' ? PREFLIGHT.imageMaxBytes : PREFLIGHT.videoMaxBytes;
  if (file.size > cap) {
    errors.push(
      `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(cap)} — trim it first.`,
    );
    return { ok: false, kind, errors, warnings };
  }

  if (kind === 'image') {
    const isHeic = looksLikeHeic(file);
    // HEIC can't be measured without decoding it, and decoding is expensive —
    // dimension checks happen inside the worker after conversion.
    if (isHeic) {
      return { ok: true, kind, errors, warnings, isHeic: true };
    }

    const dims = await imageDimensions(file);
    if (!dims) {
      errors.push(`${file.name} couldn’t be decoded as an image.`);
      return { ok: false, kind, errors, warnings };
    }
    const long = Math.max(dims.width, dims.height);
    if (long < PREFLIGHT.imageMinLongEdge) {
      warnings.push(
        `${file.name} is only ${long}px on its long edge — it'll look soft on a retina screen, but it will still upload.`,
      );
    }
    const ratio = dims.width / dims.height;
    if (ratio > 16 / 9 || ratio < 9 / 16) {
      warnings.push(
        `${file.name} is very ${ratio > 1 ? 'wide' : 'tall'} (${dims.width}×${dims.height}). The wall crops every tile to fit, so expect it to lose a lot — set a focal point after uploading.`,
      );
    }
    return { ok: true, kind, errors, warnings, ...dims };
  }

  const meta = await videoMetadata(file);
  if (!meta) {
    errors.push(`${file.name} couldn’t be read as a video. Try re-exporting it as MP4.`);
    return { ok: false, kind, errors, warnings };
  }
  if (meta.durationS > PREFLIGHT.videoMaxDurationS) {
    errors.push(
      `${file.name} is ${Math.round(meta.durationS)}s. The limit is ${PREFLIGHT.videoMaxDurationS}s — the wall only ever loops the first 12s anyway.`,
    );
    return { ok: false, kind, errors, warnings, ...meta };
  }
  if (meta.durationS > 20) {
    warnings.push(
      `${file.name} is ${Math.round(meta.durationS)}s; only the first 12s loops on the wall. The full clip stays available in the lightbox.`,
    );
  }
  return { ok: true, kind, errors, warnings, ...meta };
}

function imageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function videoMetadata(
  file: File,
): Promise<{ width: number; height: number; durationS: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => {
      const out = {
        width: v.videoWidth,
        height: v.videoHeight,
        durationS: Number.isFinite(v.duration) ? v.duration : 0,
      };
      URL.revokeObjectURL(url);
      resolve(out.width ? out : null);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    v.src = url;
  });
}

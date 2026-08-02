/**
 * Every hard number from §2 of the build spec, in one place.
 *
 * These are mirrored in supabase/migrations/0002_triggers.sql (gallery_limits()).
 * If you change one here, change it there too — the DB is the authoritative
 * enforcement point; this module is what the UI and the API routes read.
 */

export const KB = 1024;
export const MB = 1024 * 1024;
export const GB = 1024 * 1024 * 1024;

// ── §2.2 how many items a gallery should have ───────────────────────────────
export const COUNTS = {
  hardMin: 12,
  recommendedMin: 24,
  sweetSpotLow: 40,
  sweetSpotHigh: 60,
  softMax: 80,
  hardMax: 120,
} as const;

// ── §2.3 videos ─────────────────────────────────────────────────────────────
export const VIDEOS = {
  recommendedMin: 4,
  recommendedMax: 8,
  hardMax: 12,
  /** Videos should stay at or below this share of total items. */
  maxShareOfTotal: 0.2,
} as const;

// ── §2.2 size mix. Auto-assigned on bulk upload, overridable per item. ──────
export const SIZE_MIX = { s: 0.25, m: 0.4, l: 0.25, xl: 0.1 } as const;
export const SIZE_KEYS = ['s', 'm', 'l', 'xl'] as const;
export type SizeKey = (typeof SIZE_KEYS)[number];

/** The engine's own multipliers — must match the reference file exactly. */
export const SIZE_MULTIPLIERS: Record<SizeKey, number> = {
  s: 0.66,
  m: 0.92,
  l: 1.18,
  xl: 1.45,
};

/** Deterministic aspect assignment by tile index, as in the reference engine. */
export const ASPECTS = [3 / 4, 1, 4 / 3, 16 / 10, 4 / 5, 5 / 4] as const;

// ── §2.6 encoding targets ───────────────────────────────────────────────────
export const IMAGE_RENDITIONS = {
  grid: { longEdge: 1200, quality: 75, target: 120 * KB, hardMax: 400 * KB },
  full: { longEdge: 2400, quality: 82, target: 350 * KB, hardMax: 1 * MB },
} as const;

export const VIDEO_RENDITIONS = {
  poster: { longEdge: 1200, quality: 0.8, target: 100 * KB, hardMax: 300 * KB },
  /** Grid loop: 720p, no audio, ≤12 s. Audio-free is what makes autoplay reliable. */
  loop: { maxHeight: 720, maxDurationS: 12, target: 2.5 * MB, hardMax: 5 * MB },
  /** Lightbox: 1080p, audio kept. */
  full: { maxHeight: 1080, target: 20 * MB, hardMax: 20 * MB },
} as const;

/** All renditions of one media item, summed. */
export const MAX_ITEM_BYTES = 25 * MB;

// ── §2.7 pre-flight limits (before compression even starts) ────────────────
export const PREFLIGHT = {
  imageMaxBytes: 50 * MB,
  videoMaxBytes: 500 * MB,
  videoMaxDurationS: 90,
  /** Below this we warn but still allow — upscaling isn't our call to block. */
  imageMinLongEdge: 800,
  imageTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/heic',
    'image/heif',
  ],
  videoTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
} as const;

// Extensions as well as MIME types: iOS often reports an empty type for HEIC
// and .mov, so a MIME-only accept list silently hides those files in the picker.
export const ACCEPT_ATTRIBUTE = [
  ...PREFLIGHT.imageTypes,
  ...PREFLIGHT.videoTypes,
  '.heic',
  '.heif',
  '.mov',
].join(',');

// ── §2.7 aggregate quotas ───────────────────────────────────────────────────
export const QUOTAS = {
  galleryBytes: 300 * MB,
  galleryItems: COUNTS.hardMax,
  /** 2 GB of headroom under R2's 10 GB free tier. */
  accountBytes: 8 * GB,
  /** Uploads are blocked past this share of the account quota. */
  blockAtFraction: 0.95,
} as const;

// ── §2.7 adaptive re-encode ladders ─────────────────────────────────────────
// Don't fail on the first over-cap output — step down and retry, up to 3 passes.
export interface ImageLadderStep {
  quality: number;
  longEdge: number;
}

export const IMAGE_LADDER: readonly ImageLadderStep[] = [
  { quality: 82, longEdge: 2400 },
  { quality: 72, longEdge: 2400 },
  { quality: 62, longEdge: 1800 },
];

// WebCodecs has no CRF, so the ladder is expressed as a bitrate multiplier that
// lands in roughly the same place as the CRF values in the spec.
export interface VideoLadderStep {
  label: string;
  maxHeight: number;
  bitrateScale: number;
  crf: number;
}

export const VIDEO_LADDER: readonly VideoLadderStep[] = [
  { label: 'CRF 22 @1080p', maxHeight: 1080, bitrateScale: 1.0, crf: 22 },
  { label: 'CRF 26 @1080p', maxHeight: 1080, bitrateScale: 0.62, crf: 26 },
  { label: 'CRF 28 @720p', maxHeight: 720, bitrateScale: 0.45, crf: 28 },
];

// ── §2.6 page budget ────────────────────────────────────────────────────────
export const PAGE_BUDGET = {
  firstScreenBytes: 4 * MB,
  interactiveMs: 2500,
} as const;

// ── §2.4 rendered pixel sizes — used by the admin "why 1200px?" explainer ───
export const RENDER_MATH = {
  desktopBaseFraction: 0.22,
  touchBaseFraction: 0.4,
  cellFactor: 1.42,
  tileWidthFactor: 0.94,
  /** No grid tile ever needs more than this on its longest edge, at DPR 2–3. */
  maxGridDevicePx: 900,
  /** Lightbox at 1440p, DPR 2. */
  maxFullDevicePx: 2250,
} as const;

// ── helpers ─────────────────────────────────────────────────────────────────

export function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < KB) return `${n} B`;
  if (n < MB) return `${(n / KB).toFixed(0)} KB`;
  if (n < GB) return `${(n / MB).toFixed(digits)} MB`;
  return `${(n / GB).toFixed(2)} GB`;
}

/** "14.2 MB → 310 KB, 98% smaller" */
export function formatSavings(before: number, after: number): string {
  if (!before || !after) return formatBytes(after);
  const pct = Math.max(0, Math.round((1 - after / before) * 100));
  return `${formatBytes(before)} → ${formatBytes(after)}, ${pct}% smaller`;
}

/**
 * Distributes `n` items across s/m/l/xl in the 25/40/25/10 ratio, then shuffles
 * deterministically so no more than two `xl` land in a row of the grid (§2.2).
 */
export function assignSizeMix(n: number, cols = 8): SizeKey[] {
  const counts: Record<SizeKey, number> = { s: 0, m: 0, l: 0, xl: 0 };
  let assigned = 0;
  for (const k of SIZE_KEYS) {
    counts[k] = Math.floor(n * SIZE_MIX[k]);
    assigned += counts[k];
  }
  // Remainder goes to `m`, the most forgiving size.
  counts.m += n - assigned;

  const pool: SizeKey[] = [];
  for (const k of SIZE_KEYS) for (let i = 0; i < counts[k]; i++) pool.push(k);

  // Interleave rather than randomise, so the result is stable and reviewable.
  const out: SizeKey[] = [];
  const buckets: Record<SizeKey, SizeKey[]> = { s: [], m: [], l: [], xl: [] };
  for (const k of pool) buckets[k].push(k);
  const order: SizeKey[] = ['m', 's', 'l', 'm', 'xl', 's', 'm', 'l'];
  let oi = 0;
  while (out.length < n) {
    const want = order[oi++ % order.length];
    const take = buckets[want].length
      ? want
      : (SIZE_KEYS.find((k) => buckets[k].length) as SizeKey | undefined);
    if (!take) break;
    // Never a third xl inside the same grid row.
    if (take === 'xl' && xlInLastRow(out, cols) >= 2 && buckets.m.length) {
      out.push(buckets.m.pop() as SizeKey);
      continue;
    }
    out.push(buckets[take].pop() as SizeKey);
  }
  return out;
}

function xlInLastRow(out: SizeKey[], cols: number): number {
  const start = Math.floor(out.length / cols) * cols;
  let c = 0;
  for (let i = start; i < out.length; i++) if (out[i] === 'xl') c++;
  return c;
}

export type CountAdvice = {
  level: 'error' | 'warn' | 'ok';
  message: string;
};

/** The banner copy in §5 step 2, derived rather than hardcoded per case. */
export function adviseCounts(total: number, videos: number): CountAdvice[] {
  const out: CountAdvice[] = [];
  const photos = total - videos;

  if (total === 0) {
    out.push({ level: 'warn', message: 'No media yet — the wall will show placeholder tiles.' });
  } else if (total < COUNTS.hardMin) {
    out.push({
      level: 'error',
      message: `Only ${total} item${total === 1 ? '' : 's'} — the wall will visibly repeat. Add at least ${COUNTS.recommendedMin}.`,
    });
  } else if (total < COUNTS.recommendedMin) {
    out.push({
      level: 'warn',
      message: `${total} items — repeats will be noticeable while dragging. ${COUNTS.recommendedMin}+ is much better.`,
    });
  } else if (total > COUNTS.hardMax) {
    out.push({
      level: 'error',
      message: `${total} items is over the ${COUNTS.hardMax} hard maximum — first paint and drag FPS degrade on mid-range phones.`,
    });
  } else if (total > COUNTS.softMax) {
    out.push({
      level: 'warn',
      message: `${total} items → roughly ${total * 4} live tiles in the DOM. Still smooth, but ${COUNTS.softMax} is the comfortable ceiling.`,
    });
  }

  if (videos > VIDEOS.hardMax) {
    out.push({
      level: 'error',
      message: `${videos} videos — the cap is ${VIDEOS.hardMax}, and phones struggle above ${VIDEOS.recommendedMax}.`,
    });
  } else if (videos > VIDEOS.recommendedMax) {
    out.push({
      level: 'warn',
      message: `${videos} videos — above ${VIDEOS.recommendedMax}, iOS Safari may silently refuse to play some of them.`,
    });
  }

  if (total > 0 && videos / total > VIDEOS.maxShareOfTotal) {
    out.push({
      level: 'warn',
      message: `Videos are ${Math.round((videos / total) * 100)}% of the wall — keep them under ${VIDEOS.maxShareOfTotal * 100}%.`,
    });
  }

  if (!out.length && total >= COUNTS.sweetSpotLow && total <= COUNTS.sweetSpotHigh) {
    out.push({ level: 'ok', message: `${total} items, ${videos} videos, ${photos} photos. Good balance.` });
  } else if (!out.length) {
    out.push({ level: 'ok', message: `${total} items, ${videos} videos. Fine — the sweet spot is ${COUNTS.sweetSpotLow}–${COUNTS.sweetSpotHigh}.` });
  }

  return out;
}

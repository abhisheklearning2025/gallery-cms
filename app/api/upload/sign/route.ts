import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route, requireUser, requireOwnedGallery, readJson, ApiError } from '@/lib/api';
import { getQuota, assertQuotaHeadroom } from '@/lib/quota';
import { rateLimit, clientKey, UPLOAD_SIGN_LIMIT } from '@/lib/ratelimit';
import { storage, objectKey, extForContentType } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  IMAGE_RENDITIONS,
  VIDEO_RENDITIONS,
  MAX_ITEM_BYTES,
  VIDEOS,
  formatBytes,
} from '@/lib/limits';
import type { RenditionName } from '@/lib/types';

const Body = z.object({
  galleryId: z.string().uuid(),
  kind: z.enum(['image', 'video']),
  sourceBytes: z.number().int().nonnegative(),
  compressedBy: z.enum(['webcodecs', 'canvas', 'ffmpeg-wasm', 'server-sharp', 'server-ffmpeg']),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationS: z.number().nonnegative().optional(),
  lqip: z.string().max(4000).optional(),
  renditions: z
    .array(
      z.object({
        name: z.enum(['grid', 'full', 'poster', 'fallback']),
        bytes: z.number().int().positive(),
        contentType: z.string().min(3).max(64),
      }),
    )
    .min(1)
    .max(4),
});

/** Per-rendition hard ceilings from §2.7. Exceeding these is never signed. */
function hardCapFor(kind: 'image' | 'video', name: RenditionName): number {
  if (kind === 'image') {
    if (name === 'grid') return IMAGE_RENDITIONS.grid.hardMax;
    if (name === 'full' || name === 'fallback') return IMAGE_RENDITIONS.full.hardMax;
    return IMAGE_RENDITIONS.grid.hardMax;
  }
  if (name === 'poster') return VIDEO_RENDITIONS.poster.hardMax;
  if (name === 'grid') return VIDEO_RENDITIONS.loop.hardMax;
  return VIDEO_RENDITIONS.full.hardMax;
}

export const POST = route(async (req) => {
  const user = await requireUser();

  const limit = rateLimit(clientKey(req, user.id), UPLOAD_SIGN_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Slow down — try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? 'Bad request', 400);
  const body = parsed.data;

  const gallery = await requireOwnedGallery(body.galleryId, user.id);

  // ── caps, before a single byte is accepted ────────────────────────────────
  let total = 0;
  for (const r of body.renditions) {
    const cap = hardCapFor(body.kind, r.name);
    if (r.bytes > cap) {
      throw new ApiError(
        `The ${r.name} rendition is ${formatBytes(r.bytes)}, over the ${formatBytes(cap)} hard limit. ` +
          `The browser should have re-encoded it — if you're seeing this, the file is unusually complex; try a shorter clip or a simpler crop.`,
        413,
        'RENDITION_TOO_LARGE',
      );
    }
    total += r.bytes;
  }

  if (total > MAX_ITEM_BYTES) {
    throw new ApiError(
      `All renditions together come to ${formatBytes(total)}; the per-item ceiling is ${formatBytes(MAX_ITEM_BYTES)}.`,
      413,
      'ITEM_TOO_LARGE',
    );
  }

  const db = supabaseAdmin();

  // ── video count cap (§2.3) ────────────────────────────────────────────────
  const quota = await getQuota(gallery.id, user.id);
  if (body.kind === 'video' && quota.galleryVideos >= VIDEOS.hardMax) {
    throw new ApiError(
      `This gallery already has ${quota.galleryVideos} videos, which is the cap. The wall draws up to four copies of every tile at once, so ${VIDEOS.hardMax} unique videos is already ~48 potential streams; browsers stop decoding well before that. Remove one first.`,
      409,
      'VIDEO_LIMIT',
    );
  }

  assertQuotaHeadroom(quota, total);

  // ── create the row up front so the keys are stable and the quota is held ──
  const { data: nextPos } = await db
    .from('media_items')
    .select('position')
    .eq('gallery_id', gallery.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>();

  const { data: created, error } = await db
    .from('media_items')
    .insert({
      gallery_id: gallery.id,
      kind: body.kind,
      status: 'processing',
      position: (nextPos?.position ?? -1) + 1,
      source_bytes: body.sourceBytes,
      compressed_by: body.compressedBy,
      width: body.width ?? null,
      height: body.height ?? null,
      duration_s: body.durationS ?? null,
      lqip: body.lqip ?? null,
      bytes: 0,
    })
    .select('id')
    .single<{ id: string }>();

  if (error) throw new ApiError(error.message, 409);

  // ── presign ───────────────────────────────────────────────────────────────
  const store = await storage();
  const uploads = [];
  for (const r of body.renditions) {
    const key = objectKey(gallery.id, created.id, r.name, extForContentType(r.contentType));
    const signed = await store.getSignedUploadUrl({
      key,
      contentType: r.contentType,
      bytes: r.bytes,
    });
    uploads.push({ ...signed, name: r.name, bytes: r.bytes, contentType: r.contentType });
  }

  return NextResponse.json({ mediaId: created.id, uploads });
});

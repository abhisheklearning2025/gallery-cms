import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route, requireUser, requireOwnedGallery, readJson, ApiError } from '@/lib/api';
import { storage } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { drainStorageDeletions } from '@/lib/storage-cleanup';
import { MAX_ITEM_BYTES, formatBytes } from '@/lib/limits';
import type { MediaRow, RenditionName } from '@/lib/types';

const Body = z.object({
  mediaId: z.string().uuid(),
  galleryId: z.string().uuid(),
  keys: z
    .array(
      z.object({
        name: z.enum(['grid', 'full', 'poster', 'fallback']),
        key: z.string().min(1),
        declaredBytes: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(4),
  alt: z.string().max(500).optional(),
  tag: z.string().max(120).optional(),
  size: z.enum(['s', 'm', 'l', 'xl']).optional(),
});

/**
 * Called after the browser's presigned PUTs succeed.
 *
 * The client is not trusted about size: every key is HEADed and the ACTUAL
 * stored byte count is what lands in the DB. R2's presigned URLs carry a
 * signed Content-Length so a mismatch is already impossible there, but the
 * check runs regardless — it is also what protects the Supabase Storage driver,
 * whose signed uploads cannot bind a length.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? 'Bad request', 400);
  const body = parsed.data;

  const gallery = await requireOwnedGallery(body.galleryId, user.id);
  const db = supabaseAdmin();
  const store = await storage();

  const { data: media } = await db
    .from('media_items')
    .select('*')
    .eq('id', body.mediaId)
    .eq('gallery_id', gallery.id)
    .maybeSingle<MediaRow>();

  if (!media) throw new ApiError('That upload is no longer pending.', 404);

  // Images need alt text before they can go live (§7, and a DB CHECK backs it).
  // The uploader seeds this from the filename so it is never blank in practice.
  const alt = body.alt ?? media.alt;
  if (media.kind === 'image' && !alt?.trim()) {
    throw new ApiError('Images need alt text before they can be saved.', 400, 'ALT_REQUIRED');
  }

  // ── verify what is actually in the bucket ────────────────────────────────
  const heads = await Promise.all(body.keys.map((k) => store.head(k.key)));

  const problems: string[] = [];
  let actualTotal = 0;

  body.keys.forEach((k, i) => {
    const h = heads[i];
    if (!h.exists) {
      problems.push(`${k.name} never arrived in storage`);
      return;
    }
    actualTotal += h.bytes;
    // 1% slack absorbs multipart/metadata differences; a client lying about
    // size lands far outside it.
    if (Math.abs(h.bytes - k.declaredBytes) > Math.max(1024, k.declaredBytes * 0.01)) {
      problems.push(
        `${k.name} is ${formatBytes(h.bytes)} in storage but was declared as ${formatBytes(k.declaredBytes)}`,
      );
    }
  });

  if (actualTotal > MAX_ITEM_BYTES) {
    problems.push(
      `all renditions come to ${formatBytes(actualTotal)}, over the ${formatBytes(MAX_ITEM_BYTES)} per-item ceiling`,
    );
  }

  if (problems.length) {
    // Delete what was stored, fail the row, and let the outbox clean up.
    await db
      .from('media_items')
      .update({ status: 'failed', error: problems.join('; '), storage_keys: body.keys.map((k) => k.key) })
      .eq('id', media.id);
    await db.from('media_items').delete().eq('id', media.id);
    await drainStorageDeletions();

    throw new ApiError(`Upload rejected — ${problems.join('; ')}.`, 409, 'COMMIT_MISMATCH');
  }

  // ── write URLs and the real byte count ───────────────────────────────────
  const urlFor = (name: RenditionName) => {
    const hit = body.keys.find((k) => k.name === name);
    return hit ? store.getPublicUrl(hit.key) : null;
  };

  const { error } = await db
    .from('media_items')
    .update({
      status: 'ready',
      error: null,
      grid_url: urlFor('grid'),
      full_url: urlFor('full'),
      poster_url: urlFor('poster'),
      fallback_url: urlFor('fallback'),
      storage_keys: body.keys.map((k) => k.key),
      bytes: actualTotal,
      ...(alt !== undefined ? { alt } : {}),
      ...(body.tag !== undefined ? { tag: body.tag } : {}),
      ...(body.size !== undefined ? { size: body.size } : {}),
    })
    .eq('id', media.id);

  if (error) {
    // Most likely a quota trigger firing on the real (larger) byte count.
    await db.from('media_items').delete().eq('id', media.id);
    await drainStorageDeletions();
    throw new ApiError(error.message, 409);
  }

  return NextResponse.json({ ok: true, mediaId: media.id, bytes: actualTotal });
});

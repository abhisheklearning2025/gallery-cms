import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { route, requireUser, requireOwnedGallery, readJson, ApiError } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { storage } from '@/lib/storage';
import { getQuota, assertQuotaHeadroom } from '@/lib/quota';
import { processImageOnServer, processVideoOnServer, markFailed } from '@/lib/server-process';
import { galleryTag } from '@/lib/gallery-data';
import { drainStorageDeletions } from '@/lib/storage-cleanup';
import type { RenditionName } from '@/lib/types';

export const maxDuration = 60;

const Body = z.object({
  galleryId: z.string().uuid(),
  kind: z.enum(['image', 'video']),
  sourceKey: z.string().min(1),
  sourceBytes: z.number().int().positive(),
  alt: z.string().max(500).optional(),
  tag: z.string().max(120).optional(),
});

/**
 * Server-side compression fallback (§2.7) for browsers without WebCodecs.
 *
 * The original was staged to `tmp/` by /api/upload/sign-source. This route
 * creates the row, returns 202 immediately, and does the actual encoding in
 * `after()` — off the request path, as specified. The client polls the row's
 * status. The staged original is deleted whether processing succeeds or fails.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? 'Bad request', 400);
  const body = parsed.data;

  const gallery = await requireOwnedGallery(body.galleryId, user.id);
  if (!body.sourceKey.startsWith(`tmp/${user.id}/`)) {
    throw new ApiError('That staged upload isn’t yours.', 403);
  }

  const quota = await getQuota(gallery.id, user.id);
  assertQuotaHeadroom(quota, 0);

  const db = supabaseAdmin();
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
      alt: body.alt ?? null,
      tag: body.tag ?? null,
      bytes: 0,
    })
    .select('id')
    .single<{ id: string }>();

  if (error) throw new ApiError(error.message, 409);

  after(async () => {
    const store = await storage();
    try {
      const result =
        body.kind === 'image'
          ? await processImageOnServer(gallery.id, created.id, body.sourceKey)
          : await processVideoOnServer(gallery.id, created.id, body.sourceKey);

      const urlFor = (name: RenditionName) => {
        const hit = result.renditions.find((r) => r.name === name);
        return hit ? store.getPublicUrl(hit.key) : null;
      };

      await db
        .from('media_items')
        .update({
          status: 'ready',
          error: null,
          grid_url: urlFor('grid'),
          full_url: urlFor('full'),
          poster_url: urlFor('poster'),
          fallback_url: urlFor('fallback'),
          storage_keys: result.renditions.map((r) => r.key),
          bytes: result.renditions.reduce((n, r) => n + r.bytes, 0),
          width: result.width,
          height: result.height,
          duration_s: result.durationS ?? null,
          lqip: result.lqip ?? null,
          compressed_by: result.compressedBy,
          ...(body.kind === 'image' && !body.alt ? { alt: 'Photo' } : {}),
        })
        .eq('id', created.id);

      if (gallery.status === 'published') revalidateTag(galleryTag(gallery.slug), 'max');
    } catch (err) {
      await markFailed(created.id, err instanceof Error ? err.message : 'Processing failed.');
      await db.from('media_items').delete().eq('id', created.id);
      await drainStorageDeletions();
    } finally {
      // The original never survives, success or failure (§2.7).
      await store.remove([body.sourceKey]);
    }
  });

  return NextResponse.json({ ok: true, mediaId: created.id, status: 'processing' }, { status: 202 });
});

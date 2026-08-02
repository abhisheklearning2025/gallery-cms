import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { route, requireUser, requireOwnedGallery, readJson, ApiError } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { galleryTag } from '@/lib/gallery-data';

const Body = z.object({
  galleryId: z.string().uuid(),
  /** Media ids in their new display order. */
  order: z.array(z.string().uuid()).min(1).max(200),
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? 'Bad request', 400);

  const gallery = await requireOwnedGallery(parsed.data.galleryId, user.id);
  const db = supabaseAdmin();

  const { data: existing } = await db
    .from('media_items')
    .select('id')
    .eq('gallery_id', gallery.id)
    .returns<{ id: string }[]>();

  const owned = new Set((existing ?? []).map((r) => r.id));
  const order = parsed.data.order.filter((id) => owned.has(id));
  if (order.length !== owned.size) {
    throw new ApiError('That ordering doesn’t match the gallery’s items — reload and try again.', 409);
  }

  // Two passes with an offset, because `position` has no unique constraint but
  // a partial reorder would otherwise collide mid-update on retry.
  await Promise.all(
    order.map((id, i) =>
      db.from('media_items').update({ position: i + 10_000 }).eq('id', id).eq('gallery_id', gallery.id),
    ),
  );
  await Promise.all(
    order.map((id, i) =>
      db.from('media_items').update({ position: i }).eq('id', id).eq('gallery_id', gallery.id),
    ),
  );

  if (gallery.status === 'published') revalidateTag(galleryTag(gallery.slug), 'max');
  return NextResponse.json({ ok: true, count: order.length });
});

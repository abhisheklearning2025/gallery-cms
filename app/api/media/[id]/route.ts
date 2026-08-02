import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { route, requireUser, requireOwnedGallery, readJson, ApiError } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { drainStorageDeletions } from '@/lib/storage-cleanup';
import { galleryTag } from '@/lib/gallery-data';
import type { MediaRow } from '@/lib/types';

const Patch = z.object({
  size: z.enum(['s', 'm', 'l', 'xl']).optional(),
  tag: z.string().max(120).nullable().optional(),
  alt: z.string().max(500).nullable().optional(),
  focalX: z.number().min(0).max(100).optional(),
  focalY: z.number().min(0).max(100).optional(),
  position: z.number().int().min(0).optional(),
});

async function loadOwned(id: string, userId: string) {
  const db = supabaseAdmin();
  const { data: media } = await db
    .from('media_items')
    .select('*')
    .eq('id', id)
    .maybeSingle<MediaRow>();
  if (!media) throw new ApiError('Not found.', 404);
  const gallery = await requireOwnedGallery(media.gallery_id, userId);
  return { media, gallery, db };
}

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { media } = await loadOwned(id, user.id);
  return NextResponse.json(media);
});

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { media, gallery, db } = await loadOwned(id, user.id);

  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? 'Bad request', 400);
  const p = parsed.data;

  if (media.kind === 'image' && p.alt !== undefined && !p.alt?.trim()) {
    throw new ApiError('Images need alt text — it’s what a screen reader announces.', 400);
  }

  const { error } = await db
    .from('media_items')
    .update({
      ...(p.size !== undefined ? { size: p.size } : {}),
      ...(p.tag !== undefined ? { tag: p.tag } : {}),
      ...(p.alt !== undefined ? { alt: p.alt } : {}),
      ...(p.focalX !== undefined ? { focal_x: p.focalX } : {}),
      ...(p.focalY !== undefined ? { focal_y: p.focalY } : {}),
      ...(p.position !== undefined ? { position: p.position } : {}),
    })
    .eq('id', id);

  if (error) throw new ApiError(error.message, 409);

  if (gallery.status === 'published') revalidateTag(galleryTag(gallery.slug), 'max');
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { gallery, db } = await loadOwned(id, user.id);

  // The before-delete trigger queues every storage key this row owned, so the
  // objects can't survive the row (§7 — no orphans burning the free tier).
  const { error } = await db.from('media_items').delete().eq('id', id);
  if (error) throw new ApiError(error.message, 409);

  const { deleted } = await drainStorageDeletions();

  if (gallery.status === 'published') revalidateTag(galleryTag(gallery.slug), 'max');
  return NextResponse.json({ ok: true, objectsRemoved: deleted });
});

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { route, requireUser, requireOwnedGallery, readJson, ApiError } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { galleryTag } from '@/lib/gallery-data';
import { siteUrl } from '@/lib/env';
import { COUNTS } from '@/lib/limits';

const Body = z.object({ publish: z.boolean().default(true) });

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const gallery = await requireOwnedGallery(id, user.id);

  const parsed = Body.safeParse(await readJson(req).catch(() => ({})));
  const publish = parsed.success ? parsed.data.publish : true;

  const db = supabaseAdmin();

  if (publish) {
    const { count } = await db
      .from('media_items')
      .select('id', { count: 'exact', head: true })
      .eq('gallery_id', gallery.id)
      .eq('status', 'ready');

    // Publishing an empty gallery is allowed — it shows the placeholder wall,
    // which is a legitimate "coming soon" state. Below the hard minimum we warn
    // but don't block; that call is the owner's.
    const warning =
      (count ?? 0) > 0 && (count ?? 0) < COUNTS.hardMin
        ? `Published with only ${count} items — the wall will visibly repeat. ${COUNTS.recommendedMin}+ is much better.`
        : null;

    const { error } = await db
      .from('galleries')
      .update({ status: 'published', published_at: gallery.published_at ?? new Date().toISOString() })
      .eq('id', gallery.id);
    if (error) throw new ApiError(error.message, 409);

    revalidateTag(galleryTag(gallery.slug), 'max');

    return NextResponse.json({
      ok: true,
      status: 'published',
      url: `${siteUrl()}/g/${gallery.slug}`,
      itemCount: count ?? 0,
      warning,
    });
  }

  const { error } = await db.from('galleries').update({ status: 'draft' }).eq('id', gallery.id);
  if (error) throw new ApiError(error.message, 409);
  revalidateTag(galleryTag(gallery.slug), 'max');

  return NextResponse.json({ ok: true, status: 'draft' });
});

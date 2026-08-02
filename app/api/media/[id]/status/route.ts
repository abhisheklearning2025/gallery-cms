import { NextResponse } from 'next/server';
import { route, requireUser, requireOwnedGallery, ApiError } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { MediaRow } from '@/lib/types';

/** Polled by the client while the server-side fallback path is compressing. */
export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const { data } = await supabaseAdmin()
    .from('media_items')
    .select('id, gallery_id, status, bytes, error')
    .eq('id', id)
    .maybeSingle<Pick<MediaRow, 'id' | 'gallery_id' | 'status' | 'bytes' | 'error'>>();

  if (!data) throw new ApiError('Not found.', 404);
  await requireOwnedGallery(data.gallery_id, user.id);

  return NextResponse.json({ status: data.status, bytes: Number(data.bytes), error: data.error });
});

import { notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadGalleryById } from '@/lib/gallery-data';
import GalleryClient from '@/app/g/[slug]/gallery-client';
import type { GalleryRow } from '@/lib/types';

/**
 * The live render, iframed by the preview page at desktop/tablet/phone widths.
 *
 * An iframe rather than an inline mount, for two reasons: the engine sizes
 * itself from window.innerWidth/innerHeight (so it needs a real viewport to
 * respond to), and its stylesheet is deliberately unscoped to the admin's
 * Tailwind layer.
 */
export default async function PreviewFrame({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) notFound();

  const { data: gallery } = await supabaseAdmin()
    .from('galleries')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle<Pick<GalleryRow, 'owner_id'>>();

  if (!gallery || gallery.owner_id !== user.id) notFound();

  const loaded = await loadGalleryById(id);
  if (!loaded) notFound();

  return <GalleryClient config={loaded.config} />;
}

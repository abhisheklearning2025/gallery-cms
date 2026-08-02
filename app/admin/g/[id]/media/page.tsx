import { notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getQuota } from '@/lib/quota';
import WizardSteps from '@/components/admin/wizard-steps';
import MediaManager from '@/components/admin/media-manager';
import type { GalleryRow, MediaRow } from '@/lib/types';

export default async function MediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null;

  const db = supabaseAdmin();
  const { data: gallery } = await db
    .from('galleries')
    .select('*')
    .eq('id', id)
    .maybeSingle<GalleryRow>();

  if (!gallery || gallery.owner_id !== user.id) notFound();

  const { data: media } = await db
    .from('media_items')
    .select('*')
    .eq('gallery_id', gallery.id)
    .order('position', { ascending: true })
    .returns<MediaRow[]>();

  const quota = await getQuota(gallery.id, user.id).catch(() => null);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <WizardSteps id={gallery.id} current={2} />
      <h1 className="text-2xl font-semibold tracking-tight">Media</h1>
      <p className="mt-1 text-sm text-[var(--color-dim)]">
        Every file is compressed in your browser before it uploads — the originals never leave this
        device.
      </p>

      <MediaManager
        galleryId={gallery.id}
        initialItems={media ?? []}
        galleryBytes={quota?.galleryBytes ?? 0}
        accountBytes={quota?.accountBytes ?? 0}
      />
    </main>
  );
}

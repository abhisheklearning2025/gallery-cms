import { notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadGalleryById, estimateFirstScreenBytes } from '@/lib/gallery-data';
import { siteUrl } from '@/lib/env';
import WizardSteps from '@/components/admin/wizard-steps';
import PublishPanel from '@/components/admin/publish-panel';
import type { GalleryRow } from '@/lib/types';

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null;

  const { data: gallery } = await supabaseAdmin()
    .from('galleries')
    .select('*')
    .eq('id', id)
    .maybeSingle<GalleryRow>();

  if (!gallery || gallery.owner_id !== user.id) notFound();

  const loaded = await loadGalleryById(gallery.id);
  const media = loaded?.media ?? [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <WizardSteps id={gallery.id} current={4} />
      <h1 className="text-2xl font-semibold tracking-tight">Preview &amp; publish</h1>
      <p className="mt-1 text-sm text-[var(--color-dim)]">
        This is the real page, rendered in a frame at three widths — not a mock-up.
      </p>

      <PublishPanel
        gallery={{
          id: gallery.id,
          slug: gallery.slug,
          title: gallery.title,
          status: gallery.status,
          visibility: gallery.visibility,
          totalBytes: Number(gallery.total_bytes),
        }}
        stats={{
          items: media.length,
          videos: media.filter((m) => m.kind === 'video').length,
          firstScreenBytes: estimateFirstScreenBytes(media),
          missingAlt: media.filter((m) => m.kind === 'image' && !m.alt?.trim()).length,
        }}
        publicUrl={`${siteUrl()}/g/${gallery.slug}`}
        previewPath={`/admin/g/${gallery.id}/preview/frame`}
      />
    </main>
  );
}

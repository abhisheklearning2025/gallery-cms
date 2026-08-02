import { notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/env';
import WizardSteps from '@/components/admin/wizard-steps';
import DetailsForm from './details-form';
import type { GalleryRow } from '@/lib/types';

export default async function EditGalleryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null;

  const { data: gallery } = await supabaseAdmin()
    .from('galleries')
    .select('*')
    .eq('id', id)
    .maybeSingle<GalleryRow>();

  if (!gallery || gallery.owner_id !== user.id) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <WizardSteps id={gallery.id} current={1} />
      <h1 className="text-2xl font-semibold tracking-tight">{gallery.title}</h1>
      <p className="mt-1 text-sm text-[var(--color-dim)]">
        {gallery.status === 'published' ? 'Live' : 'Draft'} · /g/{gallery.slug}
      </p>

      <DetailsForm gallery={gallery} siteOrigin={siteUrl()} />
    </main>
  );
}

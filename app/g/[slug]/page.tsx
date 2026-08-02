import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import GalleryClient from './gallery-client';
import ViewBeacon from './view-beacon';
import PasswordGate from './password-gate';
import { getPublishedGallery, loadGalleryBypassingCache } from '@/lib/gallery-data';
import { unlockCookieName, unlockTokenValid } from '@/lib/unlock';
import { isConfigured, siteUrl } from '@/lib/env';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const found = await getPublishedGallery(slug);
  if (!found) return { title: 'Gallery' };
  const { gallery } = found;
  return {
    title: gallery.title,
    description: gallery.tagline,
    openGraph: {
      title: gallery.title,
      description: gallery.tagline,
      url: `${siteUrl()}/g/${gallery.slug}`,
      type: 'website',
    },
    // Unlisted means "not indexed", not "not reachable".
    robots: gallery.visibility === 'public' ? undefined : { index: false, follow: false },
  };
}

export default async function GalleryPage({ params }: { params: Params }) {
  const { slug } = await params;

  if (!isConfigured.supabase) {
    return <NotConfigured />;
  }

  // Fast path: published, non-password. Served from the 'use cache' entry.
  const cached = await getPublishedGallery(slug);
  if (cached) {
    return (
      <>
        <GalleryClient config={cached.config} listHref={`/g/${slug}/list`} />
        <ViewBeacon slug={slug} />
      </>
    );
  }

  // Slow path: either it doesn't exist, or it's password-gated.
  const found = await loadGalleryBypassingCache(slug, { requirePublished: true });
  if (!found) notFound();

  const { gallery, config } = found;
  if (gallery.visibility !== 'password') notFound();

  const jar = await cookies();
  const token = jar.get(unlockCookieName(slug))?.value;

  if (!unlockTokenValid(slug, gallery.password_hash ?? '', token)) {
    return <PasswordGate slug={slug} title={gallery.title} accent={gallery.accent} bg={gallery.bg} />;
  }

  return (
    <>
      <GalleryClient config={config} listHref={`/g/${slug}/list`} />
      <ViewBeacon slug={slug} />
    </>
  );
}

function NotConfigured() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <p className="label mb-3">Not configured</p>
      <h1 className="text-2xl font-semibold">Supabase isn&apos;t connected yet.</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-dim)]">
        Add <code className="text-[var(--color-paper)]">NEXT_PUBLIC_SUPABASE_URL</code>,{' '}
        <code className="text-[var(--color-paper)]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and{' '}
        <code className="text-[var(--color-paper)]">SUPABASE_SERVICE_ROLE_KEY</code> to{' '}
        <code className="text-[var(--color-paper)]">.env.local</code>, then run{' '}
        <code className="text-[var(--color-paper)]">pnpm migrate &amp;&amp; pnpm seed</code>. The
        walkthrough is in SETUP-TASKS.md.
      </p>
    </main>
  );
}

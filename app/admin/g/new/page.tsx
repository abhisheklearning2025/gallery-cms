import { Suspense } from 'react';
import { siteUrl } from '@/lib/env';
import NewGalleryForm from './new-gallery-form';

export default function NewGalleryPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <p className="label mb-2">Step 1 of 4</p>
      <h1 className="text-2xl font-semibold tracking-tight">Details</h1>
      <p className="mt-2 text-sm text-[var(--color-dim)]">
        The name and tagline appear top-left on the wall. Everything here can be changed later —
        except the link, once you&apos;ve published.
      </p>
      <Suspense>
        <NewGalleryForm siteOrigin={siteUrl()} />
      </Suspense>
    </main>
  );
}

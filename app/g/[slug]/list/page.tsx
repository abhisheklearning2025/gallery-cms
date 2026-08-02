import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublishedGallery } from '@/lib/gallery-data';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Keyboard-navigable, screen-reader-friendly fallback for the wall (§7).
 * A drag-to-explore canvas is not operable without a pointer; this route is the
 * same content as an ordinary document.
 */
export default async function ListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await getPublishedGallery(slug);
  if (!found) notFound();

  const { gallery, media } = found;

  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <header className="mb-10">
        <p className="label mb-2">{gallery.tagline}</p>
        <h1 className="text-3xl font-bold tracking-tight">{gallery.title}</h1>
        <p className="mt-3 text-sm text-[var(--color-dim)]">
          {media.length} item{media.length === 1 ? '' : 's'} ·{' '}
          <Link href={`/g/${slug}`} className="underline">
            back to the interactive wall
          </Link>
        </p>
      </header>

      {media.length === 0 ? (
        <p className="text-sm text-[var(--color-dim)]">Nothing has been added to this gallery yet.</p>
      ) : (
        <ol className="space-y-10">
          {media.map((m, i) => (
            <li key={m.id}>
              <figure>
                {m.kind === 'video' ? (
                  <video
                    className="w-full rounded-md border border-[var(--color-line)]"
                    src={m.fullUrl ?? m.gridUrl ?? undefined}
                    poster={m.posterUrl ?? undefined}
                    controls
                    preload="none"
                    playsInline
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="w-full rounded-md border border-[var(--color-line)]"
                    src={m.fullUrl ?? m.gridUrl ?? undefined}
                    alt={m.alt ?? ''}
                    width={m.width ?? undefined}
                    height={m.height ?? undefined}
                    loading="lazy"
                  />
                )}
                <figcaption className="label mt-3">
                  {String(i + 1).padStart(2, '0')}
                  {m.tag ? ` · ${m.tag}` : ''}
                  {m.kind === 'video' && m.durationS ? ` · ${Math.round(m.durationS)}s` : ''}
                </figcaption>
                {m.kind === 'image' && m.alt && (
                  <p className="mt-1 text-sm text-[var(--color-dim)]">{m.alt}</p>
                )}
              </figure>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

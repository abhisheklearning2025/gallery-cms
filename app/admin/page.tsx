import Link from 'next/link';
import Image from 'next/image';
import { getSessionUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isConfigured, siteUrl } from '@/lib/env';
import { formatBytes, COUNTS } from '@/lib/limits';
import { deleteGallery } from './actions';
import type { GalleryRow } from '@/lib/types';

interface Row extends GalleryRow {
  item_count: number;
  video_count: number;
  thumb: string | null;
}

export default async function AdminHome() {
  if (!isConfigured.supabase) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-14">
        <h1 className="text-xl font-semibold">Connect Supabase to get started.</h1>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-[var(--color-dim)]">
          The setup walkthrough is in SETUP-TASKS.md — it takes about fifteen minutes and everything
          it asks for is free.
        </p>
      </main>
    );
  }

  const user = await getSessionUser();
  if (!user) return null; // proxy.ts redirects; this is just for types.

  const db = supabaseAdmin();
  const { data: galleries } = await db
    .from('galleries')
    .select('*')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .returns<GalleryRow[]>();

  const rows: Row[] = [];
  for (const g of galleries ?? []) {
    const { data: media } = await db
      .from('media_items')
      .select('kind, grid_url, poster_url')
      .eq('gallery_id', g.id)
      .eq('status', 'ready')
      .order('position')
      .returns<{ kind: string; grid_url: string | null; poster_url: string | null }[]>();

    rows.push({
      ...g,
      item_count: media?.length ?? 0,
      video_count: media?.filter((m) => m.kind === 'video').length ?? 0,
      thumb: media?.[0]?.grid_url ?? media?.[0]?.poster_url ?? null,
    });
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Galleries</h1>
          <p className="mt-1 text-sm text-[var(--color-dim)]">
            {rows.length === 0
              ? 'Nothing here yet.'
              : `${rows.length} gallery${rows.length === 1 ? '' : 's'}.`}
          </p>
        </div>
        <Link href="/admin/g/new" className="btn btn-primary">
          New gallery
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-[var(--color-dim)]">
            Create your first gallery — name it, drop in 40–60 photos, publish.
          </p>
          <Link href="/admin/g/new" className="btn btn-primary mt-5">
            Start
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((g) => (
            <li key={g.id} className="card overflow-hidden">
              <Link href={`/admin/g/${g.id}`} className="block">
                <div className="relative aspect-[16/10] bg-[var(--color-panel-2)]">
                  {g.thumb ? (
                    <Image
                      src={g.thumb}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 100vw, 33vw"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div
                      className="h-full w-full"
                      style={{
                        background:
                          'repeating-linear-gradient(45deg,#191920 0 10px,#15151a 10px 20px)',
                      }}
                    />
                  )}
                  <span
                    className="label absolute left-3 top-3 rounded-full px-2 py-1"
                    style={{
                      background: g.status === 'published' ? 'var(--color-good)' : 'var(--color-panel)',
                      color: g.status === 'published' ? '#0E0E11' : 'var(--color-dim)',
                    }}
                  >
                    {g.status}
                  </span>
                </div>
              </Link>

              <div className="p-4">
                <Link href={`/admin/g/${g.id}`} className="block">
                  <h2 className="truncate font-medium">{g.title}</h2>
                  <p className="label mt-1 truncate">/g/{g.slug}</p>
                </Link>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-dim)]">
                  <span
                    style={
                      g.item_count > 0 && g.item_count < COUNTS.hardMin
                        ? { color: 'var(--color-warn)' }
                        : undefined
                    }
                  >
                    {g.item_count} items
                  </span>
                  <span>{g.video_count} video{g.video_count === 1 ? '' : 's'}</span>
                  <span>{formatBytes(Number(g.total_bytes))}</span>
                  <span>{g.view_count} views</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={`/admin/g/${g.id}/media`} className="btn px-2.5 py-1 text-xs">
                    Media
                  </Link>
                  <Link href={`/admin/g/${g.id}/preview`} className="btn px-2.5 py-1 text-xs">
                    Preview
                  </Link>
                  {g.status === 'published' && (
                    <a
                      href={`${siteUrl()}/g/${g.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn px-2.5 py-1 text-xs"
                    >
                      Open ↗
                    </a>
                  )}
                  <form action={deleteGallery} className="ml-auto">
                    <input type="hidden" name="id" value={g.id} />
                    <button type="submit" className="btn btn-danger px-2.5 py-1 text-xs">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

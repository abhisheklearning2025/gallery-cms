import 'server-only';
// Next 16.2 ships cacheLife/cacheTag as stable exports (the unstable_ aliases
// still exist but are no longer the documented name).
import { cacheLife, cacheTag } from 'next/cache';
import { supabaseAdmin } from './supabase/admin';
import { isConfigured } from './env';
import type { GalleryRow, MediaRow, PublicGalleryConfig, PublicMediaItem } from './types';

export const galleryTag = (slug: string) => `gallery:${slug}`;

export interface PublicGalleryResult {
  gallery: GalleryRow;
  config: PublicGalleryConfig;
  media: PublicMediaItem[];
}

function toPublicItem(row: MediaRow): PublicMediaItem {
  return {
    id: row.id,
    kind: row.kind,
    gridUrl: row.grid_url,
    fullUrl: row.full_url,
    posterUrl: row.poster_url,
    fallbackUrl: row.fallback_url,
    lqip: row.lqip,
    size: row.size,
    tag: row.tag,
    alt: row.alt,
    focalX: Number(row.focal_x),
    focalY: Number(row.focal_y),
    width: row.width,
    height: row.height,
    durationS: row.duration_s == null ? null : Number(row.duration_s),
    bytes: Number(row.bytes),
  };
}

export function toConfig(gallery: GalleryRow, media: PublicMediaItem[]): PublicGalleryConfig {
  return {
    title: gallery.title,
    tagline: gallery.tagline,
    accent: gallery.accent,
    bg: gallery.bg,
    driftSpeed: Number(gallery.drift_speed),
    density: Number(gallery.density),
    showFilters: gallery.show_filters,
    media,
  };
}

/**
 * The public read path. Cached per §4: `cacheLife('hours')` + a
 * `gallery:{slug}` tag that /api/gallery/[id]/publish revalidates.
 *
 * Password-gated galleries are deliberately NOT returned here — they go
 * through loadGalleryBypassingCache() only after the password check passes,
 * so a cached copy of a private gallery can never be served.
 */
export async function getPublishedGallery(slug: string): Promise<PublicGalleryResult | null> {
  'use cache';
  cacheLife('hours');
  cacheTag(galleryTag(slug));

  if (!isConfigured.supabase) return null;

  const db = supabaseAdmin();
  const { data: gallery } = await db
    .from('galleries')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .neq('visibility', 'password')
    .maybeSingle<GalleryRow>();

  if (!gallery) return null;

  const { data: rows } = await db
    .from('media_items')
    .select('*')
    .eq('gallery_id', gallery.id)
    .eq('status', 'ready')
    .order('position', { ascending: true })
    .returns<MediaRow[]>();

  const media = (rows ?? []).map(toPublicItem);
  return { gallery, config: toConfig(gallery, media), media };
}

/** Uncached read for password-unlocked and owner-preview rendering. */
export async function loadGalleryBypassingCache(
  slug: string,
  opts: { requirePublished?: boolean } = {},
): Promise<PublicGalleryResult | null> {
  if (!isConfigured.supabase) return null;
  const db = supabaseAdmin();

  let q = db.from('galleries').select('*').eq('slug', slug);
  if (opts.requirePublished) q = q.eq('status', 'published');

  const { data: gallery } = await q.maybeSingle<GalleryRow>();
  if (!gallery) return null;

  const { data: rows } = await db
    .from('media_items')
    .select('*')
    .eq('gallery_id', gallery.id)
    .eq('status', 'ready')
    .order('position', { ascending: true })
    .returns<MediaRow[]>();

  const media = (rows ?? []).map(toPublicItem);
  return { gallery, config: toConfig(gallery, media), media };
}

export async function loadGalleryById(id: string): Promise<PublicGalleryResult | null> {
  if (!isConfigured.supabase) return null;
  const db = supabaseAdmin();
  const { data: gallery } = await db
    .from('galleries')
    .select('*')
    .eq('id', id)
    .maybeSingle<GalleryRow>();
  if (!gallery) return null;

  const { data: rows } = await db
    .from('media_items')
    .select('*')
    .eq('gallery_id', id)
    .order('position', { ascending: true })
    .returns<MediaRow[]>();

  const ready = (rows ?? []).filter((r) => r.status === 'ready').map(toPublicItem);
  return { gallery, config: toConfig(gallery, ready), media: ready };
}

/**
 * First-screen weight estimate for the admin's weight report (§5 step 4).
 * The wall paints roughly one viewport of tiles at grid resolution, plus the
 * poster and first seconds of whichever videos are on screen.
 */
export function estimateFirstScreenBytes(media: PublicMediaItem[]): number {
  if (!media.length) return 0;
  const images = media.filter((m) => m.kind === 'image');
  const videos = media.filter((m) => m.kind === 'video');

  // A 2×2 block tiling shows every item up to 4×, but the browser only fetches
  // each URL once — so the first screen costs roughly one copy of everything
  // that is actually visible. Assume ~60% of the block lands on screen.
  const visibleShare = 0.6;
  const imageBytes = images.reduce((n, m) => n + m.bytes * 0.45, 0) * visibleShare;
  // Videos: poster is fetched eagerly, the loop only for the copies that mount.
  const videoBytes = videos.reduce((n, m) => n + m.bytes * 0.12, 0);
  return Math.round(imageBytes + videoBytes);
}

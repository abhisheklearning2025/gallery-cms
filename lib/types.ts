import type { SizeKey } from './limits';

export type GalleryStatus = 'draft' | 'published';
export type GalleryVisibility = 'public' | 'unlisted' | 'password';
export type MediaKind = 'image' | 'video';
export type MediaStatus = 'processing' | 'ready' | 'failed';
export type RenditionName = 'grid' | 'full' | 'poster' | 'fallback';
export type CompressedBy =
  | 'webcodecs'
  | 'canvas'
  | 'ffmpeg-wasm'
  | 'server-sharp'
  | 'server-ffmpeg';

export interface GalleryRow {
  id: string;
  owner_id: string;
  slug: string;
  title: string;
  tagline: string;
  status: GalleryStatus;
  visibility: GalleryVisibility;
  password_hash: string | null;
  accent: string;
  bg: string;
  drift_speed: number;
  density: number;
  show_filters: boolean;
  og_image_url: string | null;
  view_count: number;
  total_bytes: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaRow {
  id: string;
  gallery_id: string;
  kind: MediaKind;
  position: number;
  size: SizeKey;
  tag: string | null;
  alt: string | null;
  focal_x: number;
  focal_y: number;
  status: MediaStatus;
  error: string | null;
  grid_url: string | null;
  full_url: string | null;
  poster_url: string | null;
  fallback_url: string | null;
  lqip: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  storage_keys: string[];
  bytes: number;
  source_bytes: number;
  compressed_by: CompressedBy | null;
  created_at: string;
}

/**
 * The shape injected into the public page — this is the `GALLERY` object the
 * ported engine reads, replacing the hardcoded array in the reference file.
 */
export interface PublicGalleryConfig {
  title: string;
  tagline: string;
  accent: string;
  bg: string;
  driftSpeed: number;
  density: number;
  showFilters: boolean;
  media: PublicMediaItem[];
}

export interface PublicMediaItem {
  id: string;
  kind: MediaKind;
  gridUrl: string | null;
  fullUrl: string | null;
  posterUrl: string | null;
  fallbackUrl: string | null;
  lqip: string | null;
  size: SizeKey;
  tag: string | null;
  alt: string | null;
  focalX: number;
  focalY: number;
  width: number | null;
  height: number | null;
  durationS: number | null;
  bytes: number;
}

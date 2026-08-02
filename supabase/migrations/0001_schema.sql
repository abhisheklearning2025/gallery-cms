-- ============================================================================
-- 0001_schema.sql — tables, enums, constraints, indexes
-- Infinite Gallery CMS. Run with `pnpm migrate`.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type gallery_status as enum ('draft', 'published');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gallery_visibility as enum ('public', 'unlisted', 'password');
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_kind as enum ('image', 'video');
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_size as enum ('s', 'm', 'l', 'xl');
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_status as enum ('processing', 'ready', 'failed');
exception when duplicate_object then null; end $$;

-- ── reserved slugs ──────────────────────────────────────────────────────────
-- Kept as a table rather than a CHECK array so the list can grow without a
-- migration, and so /api/slug/check can query it directly.
create table if not exists reserved_slugs (
  slug text primary key
);

insert into reserved_slugs (slug) values
  ('admin'), ('api'), ('app'), ('about'), ('auth'), ('assets'), ('blog'),
  ('dashboard'), ('docs'), ('g'), ('help'), ('home'), ('images'), ('index'),
  ('login'), ('logout'), ('media'), ('new'), ('null'), ('privacy'), ('public'),
  ('root'), ('settings'), ('signin'), ('signup'), ('static'), ('support'),
  ('terms'), ('test'), ('undefined'), ('user'), ('users'), ('www'), ('_next')
on conflict do nothing;

-- ── galleries ───────────────────────────────────────────────────────────────
create table if not exists galleries (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,

  slug          text not null unique
                  constraint galleries_slug_format
                  check (slug ~ '^[a-z0-9]([a-z0-9-]{1,46})[a-z0-9]$'),

  title         text not null default 'Gallery',
  tagline       text not null default 'drag to explore',

  status        gallery_status     not null default 'draft',
  visibility    gallery_visibility not null default 'public',
  password_hash text,

  accent        text not null default '#5A6CFF'
                  constraint galleries_accent_hex check (accent ~* '^#[0-9a-f]{6}$'),
  bg            text not null default '#0E0E11'
                  constraint galleries_bg_hex check (bg ~* '^#[0-9a-f]{6}$'),

  -- Multipliers on the reference engine's DRIFT_X/DRIFT_Y and its 0.22/0.40
  -- base-unit constant. 1.0 == the reference file exactly.
  drift_speed   numeric not null default 1.0 check (drift_speed between 0 and 3),
  density       numeric not null default 1.0 check (density between 0.5 and 2),

  show_filters  boolean not null default true,
  og_image_url  text,
  view_count    integer not null default 0,

  -- Maintained by trigger from media_items.bytes. Drives the 300 MB per-gallery
  -- quota; never write this column directly.
  total_bytes   bigint not null default 0,

  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A password-gated gallery without a hash would be silently public.
  constraint galleries_password_present
    check (visibility <> 'password' or password_hash is not null)
);

create index if not exists galleries_owner_idx   on galleries (owner_id);
create index if not exists galleries_status_idx  on galleries (status) where status = 'published';

-- ── media_items ─────────────────────────────────────────────────────────────
create table if not exists media_items (
  id            uuid primary key default gen_random_uuid(),
  gallery_id    uuid not null references galleries (id) on delete cascade,

  kind          media_kind  not null,
  position      integer     not null default 0,
  size          media_size  not null default 'm',

  tag           text,
  alt           text,

  focal_x       numeric not null default 50 check (focal_x between 0 and 100),
  focal_y       numeric not null default 50 check (focal_y between 0 and 100),

  status        media_status not null default 'processing',
  error         text,

  -- Rendition URLs, filled by the pipeline on commit.
  --   image: grid_url = 1200px WebP · full_url = 2400px WebP · fallback_url = JPEG
  --   video: grid_url = 720p loop (no audio) · full_url = 1080p w/ audio
  --          poster_url = JPEG frame at 1s
  grid_url      text,
  full_url      text,
  poster_url    text,
  fallback_url  text,

  -- Low-quality image placeholder: a ~20px WebP as a data: URI, painted as the
  -- tile background so tiles are never flat grey before load (§6.7).
  lqip          text,

  width         integer,
  height        integer,
  duration_s    numeric,

  -- Every object key this row owns in the bucket. Deleting the row queues each
  -- of these for removal from storage (see 0002), so nothing is orphaned.
  storage_keys  text[] not null default '{}',

  bytes         bigint not null default 0,   -- sum of renditions actually stored
  source_bytes  bigint not null default 0,   -- pre-compression, for "98% smaller"
  compressed_by text,                        -- webcodecs|canvas|ffmpeg-wasm|server-sharp|server-ffmpeg

  created_at    timestamptz not null default now(),

  -- Alt text is required for images once they go live (a11y, §7).
  constraint media_alt_required_for_ready_images
    check (status <> 'ready' or kind <> 'image' or (alt is not null and length(btrim(alt)) > 0))
);

create index if not exists media_gallery_pos_idx on media_items (gallery_id, position);
create index if not exists media_status_idx      on media_items (status) where status = 'processing';

-- ── per-account usage rollup ────────────────────────────────────────────────
-- Exists so the 8 GB account quota check is one indexed read rather than a scan
-- across every gallery the user owns.
create table if not exists account_usage (
  owner_id    uuid primary key references auth.users (id) on delete cascade,
  total_bytes bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists galleries_touch on galleries;
create trigger galleries_touch before update on galleries
  for each row execute function touch_updated_at();

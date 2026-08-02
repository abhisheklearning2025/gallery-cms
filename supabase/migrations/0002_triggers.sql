-- ============================================================================
-- 0002_triggers.sql — byte accounting, quota + count enforcement, slug rules,
--                     storage-deletion outbox, view counter
-- ============================================================================

-- ── limits (single source of truth, mirrored in lib/limits.ts) ──────────────
create or replace function gallery_limits() returns table (
  max_items          int,
  max_videos         int,
  max_gallery_bytes  bigint,
  max_account_bytes  bigint
) language sql immutable as $$
  select 120, 12, 314572800::bigint, 8589934592::bigint;   -- 120 · 12 · 300 MB · 8 GB
$$;

-- ── storage deletion outbox ────────────────────────────────────────────────
-- Postgres cannot delete an S3 object transactionally. So the DB records the
-- intent atomically with the row delete, and the API route (or the nightly
-- reconciler, if the request died) performs the actual DELETE and marks it
-- done. Net effect is the guarantee we need: a deleted row can never leave a
-- live object behind, even on cascade or on a crashed request.
create table if not exists storage_deletions (
  id          bigserial primary key,
  key         text not null,
  gallery_id  uuid,
  owner_id    uuid,
  queued_at   timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists storage_deletions_pending_idx
  on storage_deletions (queued_at) where deleted_at is null;

create or replace function queue_media_storage_deletion() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text;
  o uuid;
begin
  select owner_id into o from galleries where id = old.gallery_id;
  foreach k in array old.storage_keys loop
    insert into storage_deletions (key, gallery_id, owner_id) values (k, old.gallery_id, o);
  end loop;
  return old;
end $$;

drop trigger if exists media_queue_deletion on media_items;
create trigger media_queue_deletion before delete on media_items
  for each row execute function queue_media_storage_deletion();

-- ── byte accounting ────────────────────────────────────────────────────────
-- Keeps galleries.total_bytes and account_usage.total_bytes exact, so a quota
-- check is one indexed read.
create or replace function sync_byte_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  gid    uuid;
  delta  bigint;
  owner  uuid;
begin
  if tg_op = 'INSERT' then
    gid := new.gallery_id; delta := new.bytes;
  elsif tg_op = 'UPDATE' then
    gid := new.gallery_id; delta := new.bytes - old.bytes;
    if old.gallery_id <> new.gallery_id then
      -- Item moved between galleries: subtract from the old one first.
      update galleries set total_bytes = greatest(0, total_bytes - old.bytes)
        where id = old.gallery_id;
      delta := new.bytes;
    end if;
  else
    gid := old.gallery_id; delta := -old.bytes;
  end if;

  if delta = 0 then
    return coalesce(new, old);
  end if;

  update galleries set total_bytes = greatest(0, total_bytes + delta)
    where id = gid
    returning owner_id into owner;

  if owner is not null then
    insert into account_usage (owner_id, total_bytes, updated_at)
      values (owner, greatest(0, delta), now())
    on conflict (owner_id) do update
      set total_bytes = greatest(0, account_usage.total_bytes + delta),
          updated_at  = now();
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists media_sync_bytes on media_items;
create trigger media_sync_bytes after insert or update or delete on media_items
  for each row execute function sync_byte_totals();

-- Dropping a whole gallery must release its bytes from the account rollup.
create or replace function release_gallery_bytes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.total_bytes > 0 then
    update account_usage
      set total_bytes = greatest(0, total_bytes - old.total_bytes), updated_at = now()
      where owner_id = old.owner_id;
  end if;
  -- Queue every remaining object under this gallery's prefix.
  insert into storage_deletions (key, gallery_id, owner_id)
    select unnest(storage_keys), old.id, old.owner_id
    from media_items where gallery_id = old.id;
  return old;
end $$;

drop trigger if exists galleries_release_bytes on galleries;
create trigger galleries_release_bytes before delete on galleries
  for each row execute function release_gallery_bytes();

-- ── quota + count enforcement ──────────────────────────────────────────────
-- This is the authoritative limit. Client-side checks are UX only (§7).
create or replace function enforce_media_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lim        record;
  item_count int;
  vid_count  int;
  g_bytes    bigint;
  a_bytes    bigint;
  owner      uuid;
  delta      bigint;
begin
  select * into lim from gallery_limits();

  select owner_id, total_bytes into owner, g_bytes
    from galleries where id = new.gallery_id for update;

  if owner is null then
    raise exception 'gallery % does not exist', new.gallery_id;
  end if;

  delta := new.bytes - coalesce((select bytes from media_items where id = new.id), 0);

  if tg_op = 'INSERT' then
    select count(*), count(*) filter (where kind = 'video')
      into item_count, vid_count
      from media_items where gallery_id = new.gallery_id;

    if item_count + 1 > lim.max_items then
      raise exception 'GALLERY_ITEM_LIMIT: this gallery already has % items; the hard maximum is %',
        item_count, lim.max_items;
    end if;

    if new.kind = 'video' and vid_count + 1 > lim.max_videos then
      raise exception 'VIDEO_LIMIT: this gallery already has % videos. The cap is % because the wall draws up to 4 copies of every tile at once, and browsers stop decoding somewhere around 16 concurrent videos.',
        vid_count, lim.max_videos;
    end if;
  end if;

  if g_bytes + delta > lim.max_gallery_bytes then
    raise exception 'GALLERY_QUOTA: this gallery would reach % MB; the per-gallery limit is % MB',
      round((g_bytes + delta) / 1048576.0), round(lim.max_gallery_bytes / 1048576.0);
  end if;

  select total_bytes into a_bytes from account_usage where owner_id = owner;
  if coalesce(a_bytes, 0) + delta > lim.max_account_bytes then
    raise exception 'ACCOUNT_QUOTA: this account would reach % GB; the limit is % GB',
      round((coalesce(a_bytes,0) + delta) / 1073741824.0, 2),
      round(lim.max_account_bytes / 1073741824.0, 2);
  end if;

  return new;
end $$;

drop trigger if exists media_enforce_limits on media_items;
create trigger media_enforce_limits before insert or update of bytes, gallery_id on media_items
  for each row execute function enforce_media_limits();

-- ── slug rules ─────────────────────────────────────────────────────────────
create or replace function check_slug_allowed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from reserved_slugs where slug = new.slug) then
    raise exception 'SLUG_RESERVED: "%" is reserved', new.slug;
  end if;
  return new;
end $$;

drop trigger if exists galleries_check_slug on galleries;
create trigger galleries_check_slug before insert or update of slug on galleries
  for each row execute function check_slug_allowed();

-- ── view counter ───────────────────────────────────────────────────────────
-- security definer so an anonymous visitor can bump the count without being
-- granted UPDATE on galleries.
create or replace function increment_gallery_views(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update galleries set view_count = view_count + 1
    where slug = p_slug and status = 'published';
end $$;

grant execute on function increment_gallery_views(text) to anon, authenticated;

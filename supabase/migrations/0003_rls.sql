-- ============================================================================
-- 0003_rls.sql — row level security
--   owner  : full control over their own rows
--   anon   : SELECT only, and only published + non-password galleries
-- Password-gated galleries are never readable by anon; after a correct password
-- the server re-reads them with the service-role key (see app/g/[slug]).
-- ============================================================================

alter table galleries        enable row level security;
alter table media_items      enable row level security;
alter table account_usage    enable row level security;
alter table reserved_slugs   enable row level security;
alter table storage_deletions enable row level security;

-- ── galleries ───────────────────────────────────────────────────────────────
drop policy if exists galleries_owner_all on galleries;
create policy galleries_owner_all on galleries
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists galleries_public_read on galleries;
create policy galleries_public_read on galleries
  for select
  to anon, authenticated
  using (status = 'published' and visibility <> 'password');

-- ── media_items ─────────────────────────────────────────────────────────────
drop policy if exists media_owner_all on media_items;
create policy media_owner_all on media_items
  for all
  using (
    exists (select 1 from galleries g
             where g.id = media_items.gallery_id and g.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from galleries g
             where g.id = media_items.gallery_id and g.owner_id = auth.uid())
  );

drop policy if exists media_public_read on media_items;
create policy media_public_read on media_items
  for select
  to anon, authenticated
  using (
    status = 'ready'
    and exists (
      select 1 from galleries g
       where g.id = media_items.gallery_id
         and g.status = 'published'
         and g.visibility <> 'password'
    )
  );

-- ── account_usage ───────────────────────────────────────────────────────────
drop policy if exists usage_owner_read on account_usage;
create policy usage_owner_read on account_usage
  for select using (auth.uid() = owner_id);

-- ── reserved_slugs ──────────────────────────────────────────────────────────
-- Readable so /api/slug/check can tell you *why* a slug is unavailable.
drop policy if exists reserved_read on reserved_slugs;
create policy reserved_read on reserved_slugs
  for select to anon, authenticated using (true);

-- ── storage_deletions ───────────────────────────────────────────────────────
-- Service-role only. No policy granted to anon/authenticated on purpose.

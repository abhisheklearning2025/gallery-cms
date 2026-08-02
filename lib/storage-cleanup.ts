import 'server-only';
import { supabaseAdmin } from './supabase/admin';
import { storage } from './storage';

/**
 * Drains the storage_deletions outbox: every key a deleted row owned gets
 * removed from the bucket, then the outbox row is marked done.
 *
 * Called inline right after a delete (so it feels transactional to the user)
 * and again by the nightly reconciler (so a crashed request can't leave an
 * orphan burning the free tier).
 */
export async function drainStorageDeletions(limit = 500): Promise<{ deleted: number }> {
  const db = supabaseAdmin();

  const { data: pending } = await db
    .from('storage_deletions')
    .select('id, key')
    .is('deleted_at', null)
    .order('queued_at', { ascending: true })
    .limit(limit)
    .returns<{ id: number; key: string }[]>();

  if (!pending?.length) return { deleted: 0 };

  const store = await storage();
  await store.remove(pending.map((p) => p.key));

  await db
    .from('storage_deletions')
    .update({ deleted_at: new Date().toISOString() })
    .in(
      'id',
      pending.map((p) => p.id),
    );

  return { deleted: pending.length };
}

/**
 * Nightly reconciliation (§2.7 storage hygiene): list every object in the
 * bucket, diff against media_items.storage_keys, delete anything with no DB row.
 *
 * FREE-TIER NOTE: LIST is a class-A operation on R2 (1M/month free). One full
 * pass over a few thousand objects is ~1 call per 1000 keys, so a nightly run
 * is nowhere near the limit.
 */
export async function reconcileStorage(): Promise<{
  scanned: number;
  orphans: number;
  removed: string[];
}> {
  const db = supabaseAdmin();
  const store = await storage();

  const objects = await store.list('g/');
  const { data: rows } = await db
    .from('media_items')
    .select('storage_keys')
    .returns<{ storage_keys: string[] }[]>();

  const known = new Set<string>();
  for (const r of rows ?? []) for (const k of r.storage_keys) known.add(k);

  const orphans = objects.filter((o) => !known.has(o.key)).map((o) => o.key);
  if (orphans.length) await store.remove(orphans);

  return { scanned: objects.length, orphans: orphans.length, removed: orphans };
}

/**
 * The server-fallback path stages an original under `tmp/` and deletes it as
 * soon as processing ends. This catches the case where processing died first —
 * an original must never linger in storage (§2.7).
 */
export async function sweepTempUploads(maxAgeMs = 60 * 60 * 1000): Promise<{ removed: number }> {
  const store = await storage();
  const cutoff = Date.now() - maxAgeMs;
  const objects = await store.list('tmp/');
  const stale = objects
    .filter((o) => !o.lastModified || o.lastModified.getTime() < cutoff)
    .map((o) => o.key);
  if (stale.length) await store.remove(stale);
  return { removed: stale.length };
}

/**
 * A browser tab closed mid-upload leaves a row in `processing`. Sweep anything
 * older than an hour and delete its partial objects (§2.7).
 */
export async function sweepStaleProcessing(): Promise<{ swept: number }> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const db = supabaseAdmin();

  const { data: stale } = await db
    .from('media_items')
    .select('id')
    .eq('status', 'processing')
    .lt('created_at', cutoff)
    .returns<{ id: string }[]>();

  if (!stale?.length) return { swept: 0 };

  // The before-delete trigger queues each row's storage keys automatically.
  await db
    .from('media_items')
    .delete()
    .in(
      'id',
      stale.map((s) => s.id),
    );

  await drainStorageDeletions();
  return { swept: stale.length };
}

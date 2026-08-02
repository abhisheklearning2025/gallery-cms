/**
 * Supabase Storage implementation of the same adapter. Exists so the build is
 * not locked to Cloudflare — set STORAGE_DRIVER=supabase and nothing else in
 * the codebase changes.
 *
 * FREE-TIER NOTE: Supabase Storage free tier is 1 GB and egress counts against
 * the 5 GB project bandwidth. That is roughly 3 galleries at the 300 MB cap —
 * fine for testing, not for a real event. R2 (10 GB, $0 egress) is the default
 * for exactly this reason.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseAdmin } from '../env';
import type { StorageAdapter } from './index';

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'gallery-media';

let client: SupabaseClient | null = null;
function sb() {
  const { url, key } = requireSupabaseAdmin();
  client ??= createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export function supabaseStorage(): StorageAdapter {
  return {
    name: 'supabase',

    async put(key, body, contentType) {
      const { error } = await sb()
        .storage.from(BUCKET)
        .upload(key, body as Uint8Array, { contentType, upsert: true });
      if (error) throw error;
    },

    async remove(keys) {
      if (!keys.length) return;
      const { error } = await sb().storage.from(BUCKET).remove(keys);
      if (error) throw error;
    },

    getPublicUrl(key) {
      return sb().storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
    },

    async getSignedUploadUrl({ key, contentType, expiresInSeconds = 900 }) {
      const { data, error } = await sb().storage.from(BUCKET).createSignedUploadUrl(key, {
        upsert: true,
      });
      if (error || !data) throw error ?? new Error('could not sign upload');
      return {
        url: data.signedUrl,
        key,
        // Supabase's signed upload URL does not bind Content-Length. The
        // /api/media/commit HEAD check is what catches an oversized upload on
        // this driver — see the comment there.
        headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
        expiresInSeconds,
      };
    },

    async head(key) {
      const path = key.split('/');
      const name = path.pop() as string;
      const { data, error } = await sb()
        .storage.from(BUCKET)
        .list(path.join('/'), { search: name, limit: 1 });
      const found = data?.find((f) => f.name === name);
      if (error || !found) return { exists: false, bytes: 0 };
      return {
        exists: true,
        bytes: Number(found.metadata?.size ?? 0),
        contentType: found.metadata?.mimetype as string | undefined,
      };
    },

    async list(prefix) {
      const out: { key: string; bytes: number; lastModified?: Date }[] = [];
      const walk = async (dir: string) => {
        const { data } = await sb().storage.from(BUCKET).list(dir, { limit: 1000 });
        for (const entry of data ?? []) {
          const full = dir ? `${dir}/${entry.name}` : entry.name;
          if (entry.id === null) await walk(full);
          else
            out.push({
              key: full,
              bytes: Number(entry.metadata?.size ?? 0),
              lastModified: entry.updated_at ? new Date(entry.updated_at) : undefined,
            });
        }
      };
      await walk(prefix.replace(/\/+$/, ''));
      return out;
    },
  };
}

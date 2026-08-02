import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseAdmin } from '../env';

let cached: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS entirely — use only where the route has
 * already established authorisation itself (ownership checks, password unlock,
 * cron jobs, the seed script).
 */
export function supabaseAdmin(): SupabaseClient {
  const { url, key } = requireSupabaseAdmin();
  cached ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

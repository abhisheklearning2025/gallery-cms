'use client';

import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_PUBLIC } from '../env';

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (!SUPABASE_PUBLIC.configured) {
    throw new Error(
      'Supabase is not configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local (see SETUP-TASKS.md).',
    );
  }
  cached ??= createBrowserClient(SUPABASE_PUBLIC.url, SUPABASE_PUBLIC.anonKey);
  return cached;
}

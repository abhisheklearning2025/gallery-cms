import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { requireSupabasePublic } from '../env';

/**
 * Request-scoped Supabase client. Reads the session from cookies, so every
 * query it makes is subject to RLS as that user.
 *
 * Next 16: cookies() is async.
 */
export async function createSupabaseServerClient() {
  const { url, key } = requireSupabasePublic();
  const store = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // proxy refreshes the session, so this is safe to swallow.
        }
      },
    },
  });
}

export async function getSessionUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Next 16 replaces middleware.ts with proxy.ts. Confirmed present in 16.2.12
 * (next/dist/lib/constants: PROXY_FILENAME = 'proxy').
 *
 * Two jobs:
 *   1. refresh the Supabase session cookie on every matched request
 *   2. gate /admin/* — unauthenticated users get bounced to /admin/login
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured yet: let everything through so the app still boots against
  // an empty .env.local (see SETUP-TASKS.md). The pages themselves render a
  // "not configured" state rather than crashing.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates against the auth server — do not swap this for
  // getSession(), which trusts a cookie that may have been tampered with.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLogin = pathname === '/admin/login';
  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/');

  if (isAdmin && !isLogin && !user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/admin/login';
    redirect.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(redirect);
  }

  if (isLogin && user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/admin';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. The public gallery is
     * matched too, so an admin browsing their own draft keeps a fresh session.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|mp4|webm)$).*)',
  ],
};

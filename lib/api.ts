import 'server-only';
import { NextResponse, connection } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { MissingEnvError } from './env';
import type { GalleryRow } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function fail(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Wraps a route handler so thrown errors become clean JSON, never a 500 page. */
export function route<T extends unknown[]>(
  handler: (req: Request, ...rest: T) => Promise<Response>,
) {
  return async (req: Request, ...rest: T): Promise<Response> => {
    try {
      return await handler(req, ...rest);
    } catch (err) {
      // Next signals redirects, notFound and prerender bail-outs by throwing.
      // Catching those and returning JSON would break routing and make every
      // dynamic route look like a 500 at build time.
      if (isFrameworkError(err)) throw err;

      if (err instanceof ApiError) return fail(err.message, err.status, err.code);
      if (err instanceof MissingEnvError) return fail(err.message, 503, 'NOT_CONFIGURED');

      const message = err instanceof Error ? err.message : 'Unexpected error';
      // Postgres RAISE messages from the limit triggers are written to be shown
      // to a human — surface them rather than swallowing them (§2.7).
      const tagged = /^(GALLERY_ITEM_LIMIT|VIDEO_LIMIT|GALLERY_QUOTA|ACCOUNT_QUOTA|SLUG_RESERVED):/.exec(
        message,
      );
      if (tagged) return fail(message.slice(tagged[1].length + 2).trim(), 409, tagged[1]);

      console.error('[api]', err);
      return fail(message, 500);
    }
  };
}

function isFrameworkError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest === 'string' && digest.startsWith('NEXT_')) return true;
  // Prerender abort signals during `next build` don't all carry a digest.
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /prerender(ing)? (is )?complete|bail out of prerendering/i.test(message);
}

export async function requireUser(): Promise<User> {
  // Declares the route dynamic before any cookie is touched. Without this,
  // cacheComponents tries to prerender GET handlers and the cookie read lands
  // after the prerender has already finished.
  await connection();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ApiError('Not signed in.', 401, 'UNAUTHENTICATED');
  return user;
}

/** Loads a gallery and asserts the given user owns it. */
export async function requireOwnedGallery(galleryId: string, userId: string): Promise<GalleryRow> {
  const { data, error } = await supabaseAdmin()
    .from('galleries')
    .select('*')
    .eq('id', galleryId)
    .maybeSingle<GalleryRow>();

  if (error) throw new ApiError(error.message, 500);
  // Same 404 for "doesn't exist" and "not yours" — don't leak which slugs are taken.
  if (!data) throw new ApiError('Gallery not found.', 404, 'NOT_FOUND');
  if (data.owner_id !== userId) throw new ApiError('Gallery not found.', 404, 'NOT_FOUND');
  return data;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError('Expected a JSON body.', 400);
  }
}

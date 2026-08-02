import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { unlockCookieName, unlockToken } from '@/lib/unlock';
import { rateLimit, clientKey, UNLOCK_LIMIT } from '@/lib/ratelimit';
import type { GalleryRow } from '@/lib/types';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const limit = rateLimit(`unlock:${slug}:${clientKey(req)}`, UNLOCK_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const password = typeof body.password === 'string' ? body.password : '';

  const { data: gallery } = await supabaseAdmin()
    .from('galleries')
    .select('slug, password_hash, status, visibility')
    .eq('slug', slug)
    .eq('status', 'published')
    .eq('visibility', 'password')
    .maybeSingle<Pick<GalleryRow, 'slug' | 'password_hash' | 'status' | 'visibility'>>();

  if (!gallery?.password_hash) {
    // Same shape and timing as a wrong password — don't leak which slugs exist.
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    return NextResponse.json({ error: 'That password didn’t work.' }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, gallery.password_hash);
  if (!ok) {
    return NextResponse.json({ error: 'That password didn’t work.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(unlockCookieName(slug), unlockToken(slug, gallery.password_hash), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

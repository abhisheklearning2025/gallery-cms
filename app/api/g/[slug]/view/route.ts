import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, clientKey } from '@/lib/ratelimit';
import { isConfigured } from '@/lib/env';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isConfigured.supabase) return NextResponse.json({ ok: false }, { status: 204 });

  // One counted view per visitor per minute; the client already gates on
  // sessionStorage, this stops a scripted loop inflating the number.
  const limit = rateLimit(`view:${slug}:${clientKey(req)}`, { limit: 1, windowSeconds: 60 });
  if (!limit.ok) return NextResponse.json({ ok: true, counted: false });

  await supabaseAdmin().rpc('increment_gallery_views', { p_slug: slug });
  return NextResponse.json({ ok: true, counted: true });
}

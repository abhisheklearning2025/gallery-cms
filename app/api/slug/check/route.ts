import { NextResponse } from 'next/server';
import { route, requireUser } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { validateSlug, slugProblemMessage, slugify } from '@/lib/slug';

/** Live availability check for the wizard's slug field (§5 step 1). */
export const GET = route(async (req) => {
  await requireUser();

  const url = new URL(req.url);
  const raw = (url.searchParams.get('slug') ?? '').trim().toLowerCase();
  const exceptId = url.searchParams.get('exceptId');

  const problem = validateSlug(raw);
  if (problem) {
    return NextResponse.json({
      slug: raw,
      available: false,
      reason: slugProblemMessage(problem),
      suggestion: slugify(raw) || null,
    });
  }

  const db = supabaseAdmin();

  const { data: reserved } = await db
    .from('reserved_slugs')
    .select('slug')
    .eq('slug', raw)
    .maybeSingle();

  if (reserved) {
    return NextResponse.json({
      slug: raw,
      available: false,
      reason: `“${raw}” is reserved by the app itself.`,
      suggestion: `${raw}-gallery`,
    });
  }

  let q = db.from('galleries').select('id').eq('slug', raw);
  if (exceptId) q = q.neq('id', exceptId);
  const { data: taken } = await q.maybeSingle();

  if (taken) {
    return NextResponse.json({
      slug: raw,
      available: false,
      reason: 'Already taken.',
      suggestion: `${raw}-2`,
    });
  }

  return NextResponse.json({ slug: raw, available: true, reason: null, suggestion: null });
});

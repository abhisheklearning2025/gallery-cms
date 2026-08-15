/**
 * Rewrites stored media URLs onto a new public base, for when the bucket moves
 * from the pub-*.r2.dev development URL to a custom domain.
 *
 *   pnpm rebase-urls           # dry run, prints what would change
 *   pnpm rebase-urls --apply   # writes
 *
 * Renditions are recorded as ABSOLUTE urls at processing time (media_items
 * .grid_url/.full_url/.poster_url/.fallback_url and galleries.og_image_url are
 * all built from getPublicUrl). Changing R2_PUBLIC_BASE_URL therefore only
 * affects items processed AFTER the change -- everything already uploaded keeps
 * pointing at the old host. That matters more than it sounds: next.config.ts
 * derives images.remotePatterns from the same variable, so the moment the env
 * var changes, the old host stops being an allowed image source and every admin
 * thumbnail for existing media starts failing.
 *
 * The object keys never change, only the origin in front of them, so this is a
 * pure string rewrite -- nothing is re-uploaded and no storage call is made.
 *
 * Run this AFTER setting the new R2_PUBLIC_BASE_URL and BEFORE (or right after)
 * redeploying; the redeploy is what flushes the cached gallery pages.
 */
// Next reads .env.local; plain `dotenv/config` only reads .env, so these
// scripts have to point at .env.local explicitly or every var comes back unset.
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@supabase/supabase-js';

const MEDIA_COLUMNS = ['grid_url', 'full_url', 'poster_url', 'fallback_url'] as const;

const apply = process.argv.includes('--apply');

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const newBase = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '');

  const missing = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !newBase && 'R2_PUBLIC_BASE_URL',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`\n  Missing in .env.local: ${missing.join(', ')}\n`);
    process.exit(1);
  }

  const db = createClient(url as string, serviceKey as string, {
    auth: { persistSession: false },
  });

  const { data: media, error } = await db
    .from('media_items')
    .select('id, grid_url, full_url, poster_url, fallback_url');
  if (error) throw error;

  const { data: galleries, error: gErr } = await db
    .from('galleries')
    .select('id, slug, og_image_url');
  if (gErr) throw gErr;

  // Whatever origins are actually in there, minus the one we're moving to.
  // Inferring beats asking for the old host: a bucket that has already been
  // rebased once can hold more than one.
  const stale = new Set<string>();
  for (const row of media ?? []) {
    for (const col of MEDIA_COLUMNS) {
      const o = originOf((row as Record<string, string | null>)[col] ?? '');
      if (o && o !== newBase) stale.add(o);
    }
  }
  for (const g of galleries ?? []) {
    const o = originOf(g.og_image_url ?? '');
    if (o && o !== newBase) stale.add(o);
  }

  console.log(`\n  new base   ${newBase}`);
  console.log(`  found      ${media?.length ?? 0} media rows, ${galleries?.length ?? 0} galleries`);

  if (!stale.size) {
    console.log(`\n  Nothing to do — every stored URL already uses the new base.\n`);
    return;
  }
  console.log(`  rewriting  ${[...stale].join(', ')}\n`);

  const rebase = (v: string | null): string | null => {
    if (!v) return v;
    const o = originOf(v);
    return o && stale.has(o) ? newBase + v.slice(o.length) : v;
  };

  let mediaChanged = 0;
  for (const row of media ?? []) {
    const r = row as Record<string, string | null> & { id: string };
    const patch: Record<string, string | null> = {};
    for (const col of MEDIA_COLUMNS) {
      const next = rebase(r[col]);
      if (next !== r[col]) patch[col] = next;
    }
    if (!Object.keys(patch).length) continue;
    mediaChanged++;
    if (mediaChanged <= 3) {
      const [col, val] = Object.entries(patch)[0];
      console.log(`    ${r.id.slice(0, 8)}…  ${col}\n      → ${val}`);
    }
    if (apply) {
      const { error: uErr } = await db.from('media_items').update(patch).eq('id', r.id);
      if (uErr) throw uErr;
    }
  }
  if (mediaChanged > 3) console.log(`    … and ${mediaChanged - 3} more`);

  let galleriesChanged = 0;
  for (const g of galleries ?? []) {
    const next = rebase(g.og_image_url);
    if (next === g.og_image_url) continue;
    galleriesChanged++;
    if (apply) {
      const { error: uErr } = await db
        .from('galleries')
        .update({ og_image_url: next })
        .eq('id', g.id);
      if (uErr) throw uErr;
    }
  }

  console.log(
    `\n  ${apply ? 'Updated' : 'Would update'} ${mediaChanged} media row(s) and ` +
      `${galleriesChanged} gallery og image(s).`,
  );
  console.log(
    apply
      ? `  Redeploy now — the gallery pages are cached and only a new deployment flushes them.\n`
      : `  Dry run. Re-run with --apply to write.\n`,
  );
}

main().catch((err) => {
  console.error('\n', err?.message ?? err, '\n');
  process.exit(1);
});

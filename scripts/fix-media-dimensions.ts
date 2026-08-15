/**
 * Repairs media rows whose stored width/height disagree with the rendition that
 * was actually produced.
 *
 *   pnpm fix-dimensions           # dry run
 *   pnpm fix-dimensions --apply   # writes
 *
 * processImageOnServer used to read sharp's metadata() -- which reports the
 * dimensions as stored on the sensor, before the EXIF orientation flag -- while
 * building its renditions through .rotate(), which applies it. Every portrait
 * frame off a DSLR or phone therefore got landscape dimensions recorded against
 * a portrait image. The wall sizes tiles from those numbers, so it built a
 * landscape tile and object-fit:cover cropped most of the photo away.
 *
 * The renditions themselves are correct -- only the recorded numbers are wrong,
 * so nothing needs re-encoding. This reads the real shape back from the stored
 * grid rendition and transposes the row where it disagrees.
 */
// Next reads .env.local; plain `dotenv/config` only reads .env, so these
// scripts have to point at .env.local explicitly or every var comes back unset.
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`\n  Missing in .env.local: ${missing.join(', ')}\n`);
    process.exit(1);
  }

  const { default: sharp } = await import('sharp');
  const db = createClient(url as string, serviceKey as string, {
    auth: { persistSession: false },
  });

  const { data, error } = await db
    .from('media_items')
    .select('id, kind, width, height, grid_url')
    .eq('status', 'ready')
    .eq('kind', 'image');
  if (error) throw error;

  const rows = (data ?? []).filter((r) => r.grid_url && r.width && r.height);
  console.log(`\n  checking ${rows.length} ready image(s)\n`);

  let fixed = 0;
  let unreadable = 0;

  for (const r of rows) {
    let real: { width?: number; height?: number };
    try {
      const res = await fetch(r.grid_url as string);
      if (!res.ok) throw new Error(String(res.status));
      real = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    } catch {
      unreadable++;
      continue;
    }
    if (!real.width || !real.height) {
      unreadable++;
      continue;
    }

    const storedAspect = (r.width as number) / (r.height as number);
    const realAspect = real.width / real.height;
    if (Math.abs(storedAspect - realAspect) <= 0.02) continue;

    // Only a transpose is safe to infer. Anything else means the row and the
    // rendition disagree for some reason this script didn't anticipate, and
    // guessing would make it worse -- report and leave it alone.
    if (Math.abs(1 / storedAspect - realAspect) > 0.02) {
      console.log(
        `    ? ${r.id.slice(0, 8)}…  stored ${r.width}x${r.height} vs rendition ` +
          `${real.width}x${real.height} — not a transpose, skipped`,
      );
      continue;
    }

    fixed++;
    if (fixed <= 5) {
      console.log(
        `    ✓ ${r.id.slice(0, 8)}…  ${r.width}x${r.height} → ${r.height}x${r.width}`,
      );
    }
    if (apply) {
      const { error: uErr } = await db
        .from('media_items')
        .update({ width: r.height, height: r.width })
        .eq('id', r.id);
      if (uErr) throw uErr;
    }
  }
  if (fixed > 5) console.log(`    … and ${fixed - 5} more`);

  console.log(
    `\n  ${apply ? 'Transposed' : 'Would transpose'} ${fixed} row(s)` +
      (unreadable ? `, ${unreadable} rendition(s) unreadable` : ''),
  );
  console.log(
    apply
      ? `  Redeploy to flush the cached gallery pages.\n`
      : `  Dry run. Re-run with --apply to write.\n`,
  );
}

main().catch((err) => {
  console.error('\n', err?.message ?? err, '\n');
  process.exit(1);
});

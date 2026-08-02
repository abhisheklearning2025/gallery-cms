/**
 * Creates the single admin user and one demo gallery.
 *
 *   pnpm seed
 *
 * There is no public signup (§4) — this script is the only way an account is
 * created. Re-running it updates the existing user's password rather than
 * failing, so it doubles as a password reset.
 *
 * The demo gallery is deliberately left with zero media items: the ported
 * engine renders the reference file's 40 striped placeholder tiles for an
 * empty gallery (§6.8), so you can see the wall working before uploading
 * anything.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  const missing = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !email && 'ADMIN_EMAIL',
    !password && 'ADMIN_PASSWORD',
  ].filter(Boolean);

  if (missing.length) {
    console.error(`\n  Missing in .env.local: ${missing.join(', ')}\n  See SETUP-TASKS.md.\n`);
    process.exit(1);
  }
  if ((password as string).length < 12) {
    console.error('\n  ADMIN_PASSWORD must be at least 12 characters.\n');
    process.exit(1);
  }

  const supabase = createClient(url as string, serviceKey as string, {
    auth: { persistSession: false },
  });

  // ── admin user ────────────────────────────────────────────────────────────
  let userId: string | undefined;

  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email?.toLowerCase() === (email as string).toLowerCase());

  if (existing) {
    userId = existing.id;
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: password as string,
      email_confirm: true,
    });
    if (error) throw error;
    console.log(`  ·  admin user ${email} already existed — password updated`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: email as string,
      password: password as string,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`  ✓  created admin user ${email}`);
  }

  // ── demo gallery ──────────────────────────────────────────────────────────
  const slug = 'demo';
  const { data: found } = await supabase
    .from('galleries')
    .select('id, slug')
    .eq('slug', slug)
    .maybeSingle();

  if (found) {
    console.log(`  ·  demo gallery already exists at /g/${slug}`);
  } else {
    const { error } = await supabase.from('galleries').insert({
      owner_id: userId,
      slug,
      title: 'Abhishek & Krati',
      tagline: '12 · 11 · 2025 · Jaipur',
      status: 'published',
      visibility: 'public',
      accent: '#5A6CFF',
      bg: '#0E0E11',
      published_at: new Date().toISOString(),
    });
    if (error) throw error;
    console.log(`  ✓  created demo gallery at /g/${slug} (40 placeholder tiles)`);
  }

  console.log(
    `\n  Done. Log in at /admin/login with ${email}.\n` +
      `  Now delete ADMIN_PASSWORD from .env.local.\n`,
  );
}

main().catch((err) => {
  console.error('\n', err?.message ?? err, '\n');
  process.exit(1);
});

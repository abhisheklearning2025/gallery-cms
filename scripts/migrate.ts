/**
 * Runs supabase/migrations/*.sql in filename order against SUPABASE_DB_URL.
 * Applied files are recorded in _migrations, so re-running is a no-op.
 *
 *   pnpm migrate
 */
// Next reads .env.local; plain `dotenv/config` only reads .env, so these
// scripts have to point at .env.local explicitly or every var comes back unset.
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

const DIR = join(process.cwd(), 'supabase', 'migrations');

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      '\n  SUPABASE_DB_URL is not set.\n' +
        '  Supabase dashboard → Project Settings → Database → Connection string → URI,\n' +
        '  then replace [YOUR-PASSWORD] with your database password.\n' +
        '  See SETUP-TASKS.md, Task 1 step 6.\n',
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await client.query<{ name: string }>('select name from _migrations');
  const applied = new Set(rows.map((r) => r.name));

  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ·  ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(join(DIR, file), 'utf8');
    process.stdout.write(`  →  ${file} `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into _migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log('✓');
      ran++;
    } catch (err) {
      await client.query('rollback');
      console.log('✗');
      console.error(`\n${(err as Error).message}\n`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(ran ? `\n  ${ran} migration(s) applied.\n` : '\n  Up to date.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

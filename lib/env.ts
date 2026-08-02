/**
 * Env access with actionable errors. Nothing here throws at import time — the
 * app must still boot with an empty .env.local so the admin UI and the
 * placeholder wall render before Supabase/R2 exist (see SETUP-TASKS.md).
 */

export class MissingEnvError extends Error {
  constructor(names: string[], what: string) {
    super(
      `${what} is not configured. Missing ${names.join(', ')} in .env.local — see SETUP-TASKS.md.`,
    );
    this.name = 'MissingEnvError';
  }
}

function need(names: string[], what: string): string[] {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new MissingEnvError(missing, what);
  return names.map((n) => process.env[n] as string);
}

export const SUPABASE_PUBLIC = {
  get url() {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  },
  get anonKey() {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  },
  get configured() {
    return Boolean(this.url && this.anonKey);
  },
};

export function requireSupabasePublic() {
  const [url, key] = need(
    ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    'Supabase',
  );
  return { url, key };
}

export function requireSupabaseAdmin() {
  const [url, key] = need(
    ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    'Supabase (service role)',
  );
  return { url, key };
}

export function requireR2() {
  const [accountId, bucket, accessKeyId, secretAccessKey, publicBase] = need(
    [
      'R2_ACCOUNT_ID',
      'R2_BUCKET',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_PUBLIC_BASE_URL',
    ],
    'Cloudflare R2',
  );
  return {
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBase: publicBase.replace(/\/+$/, ''),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

export const storageDriver = (): 'r2' | 'supabase' =>
  process.env.STORAGE_DRIVER === 'supabase' ? 'supabase' : 'r2';

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export const isConfigured = {
  get supabase() {
    return SUPABASE_PUBLIC.configured && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  get storage() {
    return storageDriver() === 'supabase'
      ? SUPABASE_PUBLIC.configured
      : Boolean(
          process.env.R2_ACCOUNT_ID &&
            process.env.R2_BUCKET &&
            process.env.R2_ACCESS_KEY_ID &&
            process.env.R2_SECRET_ACCESS_KEY &&
            process.env.R2_PUBLIC_BASE_URL,
        );
  },
};

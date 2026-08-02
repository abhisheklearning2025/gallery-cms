import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Password-gated galleries: after a correct password the visitor gets a cookie
 * whose value is an HMAC over the slug and the current password hash. Changing
 * the password therefore invalidates every outstanding unlock cookie, and the
 * cookie itself carries no secret.
 */
export const unlockCookieName = (slug: string) => `ig_unlock_${slug}`;

function secret(): string {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to gate password galleries.');
  return s;
}

export function unlockToken(slug: string, passwordHash: string): string {
  return createHmac('sha256', secret()).update(`${slug}:${passwordHash}`).digest('base64url');
}

export function unlockTokenValid(
  slug: string,
  passwordHash: string,
  token: string | undefined,
): boolean {
  if (!token) return false;
  const expected = unlockToken(slug, passwordHash);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

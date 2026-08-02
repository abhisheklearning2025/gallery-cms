/**
 * Token-bucket rate limiter for the upload-signing endpoint (§7).
 *
 * FREE-TIER NOTE: this is in-process. On Vercel Hobby each serverless instance
 * has its own map, so the effective limit is per-instance, and it resets on
 * cold start. That is enough to stop a runaway upload loop from burning the R2
 * class-A operation quota, which is what this is for. If you ever need a real
 * distributed limit, swap the Map for Upstash Redis — the interface below
 * doesn't change.
 */

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): RateLimitResult {
  const now = Date.now();

  // Cheap GC so the map can't grow without bound.
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) {
      if (now - b.updatedAt > windowSeconds * 2000) buckets.delete(k);
    }
    lastSweep = now;
  }

  const refillPerMs = limit / (windowSeconds * 1000);
  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((1 - bucket.tokens) / refillPerMs / 1000),
    };
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
}

export const UPLOAD_SIGN_LIMIT = { limit: 120, windowSeconds: 60 } as const;
export const UNLOCK_LIMIT = { limit: 10, windowSeconds: 300 } as const;

export function clientKey(req: Request, userId?: string): string {
  if (userId) return `u:${userId}`;
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  return `ip:${fwd.split(',')[0].trim() || 'unknown'}`;
}

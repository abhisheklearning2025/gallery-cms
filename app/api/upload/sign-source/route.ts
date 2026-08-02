import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route, requireUser, requireOwnedGallery, readJson, ApiError } from '@/lib/api';
import { rateLimit, clientKey, UPLOAD_SIGN_LIMIT } from '@/lib/ratelimit';
import { storage } from '@/lib/storage';
import { PREFLIGHT, formatBytes } from '@/lib/limits';

const Body = z.object({
  galleryId: z.string().uuid(),
  kind: z.enum(['image', 'video']),
  bytes: z.number().int().positive(),
  contentType: z.string().min(3).max(64),
});

/**
 * Presigns a TEMPORARY upload of an ORIGINAL file, used only by the
 * server-side fallback path (§2.7) for browsers that can't compress locally.
 *
 * The key lives under `tmp/` and is deleted the moment processing finishes or
 * fails. It is never referenced by a media row, never served publicly, and the
 * nightly reconciler removes anything left behind — so the "no file is ever
 * stored as uploaded" rule still holds.
 */
export const POST = route(async (req) => {
  const user = await requireUser();

  const limit = rateLimit(clientKey(req, user.id), UPLOAD_SIGN_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Slow down — try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? 'Bad request', 400);
  const { galleryId, kind, bytes, contentType } = parsed.data;

  await requireOwnedGallery(galleryId, user.id);

  const cap = kind === 'image' ? PREFLIGHT.imageMaxBytes : PREFLIGHT.videoMaxBytes;
  if (bytes > cap) {
    throw new ApiError(
      `That file is ${formatBytes(bytes)}. The limit for ${kind === 'image' ? 'photos' : 'video'} is ${formatBytes(cap)}.`,
      413,
    );
  }

  const ext = contentType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  const key = `tmp/${user.id}/${crypto.randomUUID()}.${ext}`;

  const store = await storage();
  const signed = await store.getSignedUploadUrl({ key, contentType, bytes });

  return NextResponse.json({ ...signed, key });
});

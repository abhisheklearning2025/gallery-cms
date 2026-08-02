import 'server-only';
import { supabaseAdmin } from './supabase/admin';
import { QUOTAS, formatBytes } from './limits';
import { ApiError } from './api';

export interface QuotaSnapshot {
  galleryBytes: number;
  galleryItems: number;
  galleryVideos: number;
  accountBytes: number;
  galleryHeadroom: number;
  accountHeadroom: number;
  accountFraction: number;
}

export async function getQuota(galleryId: string, ownerId: string): Promise<QuotaSnapshot> {
  const db = supabaseAdmin();

  const [{ data: gallery }, { data: usage }, { count: itemCount }, { count: videoCount }] =
    await Promise.all([
      db.from('galleries').select('total_bytes').eq('id', galleryId).maybeSingle<{ total_bytes: number }>(),
      db.from('account_usage').select('total_bytes').eq('owner_id', ownerId).maybeSingle<{ total_bytes: number }>(),
      db.from('media_items').select('id', { count: 'exact', head: true }).eq('gallery_id', galleryId),
      db
        .from('media_items')
        .select('id', { count: 'exact', head: true })
        .eq('gallery_id', galleryId)
        .eq('kind', 'video'),
    ]);

  const galleryBytes = Number(gallery?.total_bytes ?? 0);
  const accountBytes = Number(usage?.total_bytes ?? 0);

  return {
    galleryBytes,
    galleryItems: itemCount ?? 0,
    galleryVideos: videoCount ?? 0,
    accountBytes,
    galleryHeadroom: Math.max(0, QUOTAS.galleryBytes - galleryBytes),
    accountHeadroom: Math.max(0, QUOTAS.accountBytes - accountBytes),
    accountFraction: accountBytes / QUOTAS.accountBytes,
  };
}

export async function getAccountUsage(ownerId: string): Promise<number> {
  const { data } = await supabaseAdmin()
    .from('account_usage')
    .select('total_bytes')
    .eq('owner_id', ownerId)
    .maybeSingle<{ total_bytes: number }>();
  return Number(data?.total_bytes ?? 0);
}

/**
 * Pre-flight quota gate for /api/upload/sign. The DB trigger is the real
 * enforcement point — this exists so we refuse *before* handing out a
 * presigned URL, rather than after the bytes are already in the bucket.
 */
export function assertQuotaHeadroom(q: QuotaSnapshot, incomingBytes: number) {
  if (q.accountFraction >= QUOTAS.blockAtFraction) {
    throw new ApiError(
      `Account storage is at ${Math.round(q.accountFraction * 100)}% of ${formatBytes(QUOTAS.accountBytes)}. ` +
        `Delete a gallery or some videos before uploading more — videos are usually where the space went.`,
      409,
      'ACCOUNT_QUOTA',
    );
  }

  if (incomingBytes > q.galleryHeadroom) {
    throw new ApiError(
      `This gallery has ${formatBytes(q.galleryHeadroom)} left of its ${formatBytes(QUOTAS.galleryBytes)} budget, ` +
        `and this upload needs ${formatBytes(incomingBytes)}.`,
      409,
      'GALLERY_QUOTA',
    );
  }

  if (incomingBytes > q.accountHeadroom) {
    throw new ApiError(
      `Your account has ${formatBytes(q.accountHeadroom)} left of ${formatBytes(QUOTAS.accountBytes)}, ` +
        `and this upload needs ${formatBytes(incomingBytes)}.`,
      409,
      'ACCOUNT_QUOTA',
    );
  }

  if (q.galleryItems >= QUOTAS.galleryItems) {
    throw new ApiError(
      `This gallery already has ${q.galleryItems} items, which is the hard maximum. Above this, first paint and drag FPS degrade on mid-range phones.`,
      409,
      'GALLERY_ITEM_LIMIT',
    );
  }
}

import { NextResponse } from 'next/server';
import { route, ApiError } from '@/lib/api';
import {
  drainStorageDeletions,
  reconcileStorage,
  sweepStaleProcessing,
  sweepTempUploads,
} from '@/lib/storage-cleanup';

// Route handlers are dynamic by default under cacheComponents; `export const
// dynamic` is rejected outright, so there's nothing to declare here.
export const maxDuration = 60;

/**
 * Nightly housekeeping (§2.7 storage hygiene). Wired up in vercel.json.
 *
 * Vercel Hobby allows cron jobs at a once-per-day granularity, which is exactly
 * what this needs. Protected by CRON_SECRET so it can't be triggered from
 * outside — Vercel sends it as a bearer token automatically.
 */
export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    throw new ApiError('Not authorised.', 401);
  }

  const drained = await drainStorageDeletions(1000);
  const swept = await sweepStaleProcessing();
  const temps = await sweepTempUploads();
  const reconciled = await reconcileStorage();

  const summary = {
    queuedDeletionsProcessed: drained.deleted,
    staleProcessingRowsSwept: swept.swept,
    tempOriginalsRemoved: temps.removed,
    objectsScanned: reconciled.scanned,
    orphansRemoved: reconciled.orphans,
    removedKeys: reconciled.removed.slice(0, 50),
  };

  console.log('[reconcile]', JSON.stringify(summary));
  return NextResponse.json(summary);
});

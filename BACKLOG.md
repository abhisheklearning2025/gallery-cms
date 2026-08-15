# BACKLOG

Open work, in priority order. Written 2026-08-16, after the first production
upload session. Each item records the evidence it was diagnosed from, so none of
it has to be re-derived.

---

## P0 — Browser compression never runs

Every image in the live gallery is `compressed_by: server-sharp`. Nothing has
ever compressed locally, so the server fallback (§2.7) is doing 100% of the
work it was written to avoid.

**Cause.** A dedicated worker's script must be served with a COEP compatible
with the document that creates it. `next.config.ts` sets COEP on `/admin/:path*`
only, and the worker's chunk is served from `/_next/static`:

```
/admin/login               cross-origin-embedder-policy: credentialless
/_next/static/chunks/*.js  (no COEP header)
```

Worker creation therefore fails. It fails *asynchronously*, so it lands on
`pool.ts` `worker.onerror` → "The compression worker crashed" → `upload.ts`
catches it, finds no match in the cap-breach regex, and quietly retries on the
server.

**Fix.** Serve COEP (and CORP) on `/_next/static/:path*` as well.

**Why it's P0.** The original is supposed to never leave the device; today every
upload stages it to R2, processes it server-side and deletes it. It also spends
Vercel function time on every single upload. And it is a hard prerequisite for
video: server-side video cannot run on Vercel at all (no ffmpeg binary — see
`lib/server-process.ts`), so video depends entirely on the browser path, and
ffmpeg.wasm additionally needs `SharedArrayBuffer`, which needs exactly this
COOP/COEP pair.

## P0b — Two latent pool bugs, exposed by the above

Both in `lib/compress/pool.ts`, and both more dangerous than the header itself.

1. `drain()` breaks out of its loop when `spawn()` returns null, leaving the job
   sitting in the queue with its promise **never settled** — no resolve, no
   reject, no fallback. The comment on `spawn()` says "the caller falls back to
   inline work"; there is no such fallback anywhere.
2. `worker.onerror` never removes the dead worker from `this.workers`, so once
   `MAX_WORKERS` have failed, `spawn()` returns null forever. `compressionPool()`
   is a module singleton, so this persists for the whole page session.

Together: the first two failures fall back to the server, and every upload after
that hangs silently and permanently. Easy to miss when uploading in batches with
reloads in between.

**Fix.** Reject queued jobs when no worker can be spawned, so `upload.ts` takes
its server fallback; and drop dead workers from `workers` so the pool can
recover.

## P1 — Unknown gallery slugs return HTTP 200

```
/g/kratiabhishek        200
/g/nope-does-not-exist  200   <- should be 404
```

A mistyped link renders as a broken gallery rather than "not found", and search
engines will index URLs that don't exist. Most likely the PPR shell being
returned before the dynamic segment reaches `notFound()`.

## P1 — `pnpm reconcile` is broken

`package.json` points at `scripts/reconcile.ts`, which does not exist. The
nightly cron route (`app/api/cron/reconcile`) is real and works — only the
manual command is missing. Either write the script or drop the entry.

---

## P2

- **Custom domain for R2.** `pub-*.r2.dev` is rate-limited and unsupported for
  production traffic. Tooling is already in place (`pnpm rebase-urls`); the only
  blocker is owning a domain on Cloudflare. Full sequence in `SETUP-TASKS.md`,
  "Moving to a custom domain" — the rebase step is not optional, because
  rendition URLs are stored absolute.
- **Stable layout.** The wall re-scatters on every load *and every resize*.
  Seeding the RNG from the gallery id would give each gallery a fixed but
  arbitrary arrangement. The resize reshuffle is the more jarring of the two.
- **Failed-upload UX.** Failed rows are now kept rather than deleted (that is
  what makes the error visible at all), so: confirm the arrange grid surfaces
  `error` text, and note that `sweepStaleProcessing` only sweeps `processing`,
  never `failed` — nothing ages them out.

## P3

- **Rotate the R2 credentials.** They appeared in a chat transcript.
- **Delete `ADMIN_PASSWORD` from `.env.local`.** Seeding is done; the script
  says so on completion.
- **Turbopack NFT warning** — "whole project was traced unintentionally",
  pointing at `next.config.ts`. Pre-existing (confirmed against a clean tree),
  currently harmless, but it inflates what gets traced into the bundle.
- **Video is entirely untested.** No videos uploaded yet. Blocked behind P0.

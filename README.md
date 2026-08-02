# Infinite Gallery — CMS

An admin logs in, creates a gallery, drag-drops photos and videos, and gets a live public URL at a slug (`/g/abhishek-krati`). The public page is the reference `gallery.html` engine, ported as-is — same physics, same look, same interactions — with the media loaded from a database instead of a hardcoded array.

Every file is compressed **in the browser** before upload. The original never leaves the device, and nothing is ever stored as uploaded.

---

## Stack

| Layer | Package | Pinned |
|---|---|---|
| Framework | `next` — App Router, TypeScript, Turbopack | **16.2.12** |
| UI | `react` / `react-dom` | 19.2.8 |
| Runtime | Node.js | **24 LTS** (`.nvmrc`, `engines`) |
| Auth + DB | `@supabase/supabase-js` + `@supabase/ssr` | 2.111.0 / 0.12.4 |
| Media storage | Cloudflare R2 via `@aws-sdk/client-s3` | 3.1101.0 |
| Images (fallback) | `sharp` | 0.35.3 |
| Video (fallback) | `fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg` | 2.1.3 / 1.1.0 |
| Styling (admin only) | `tailwindcss` — CSS-first `@theme`, no config file | 4.3.3 |
| Language | `typescript`, `strict: true` | 5.9.3 |

Package manager **pnpm 11**, lockfile committed.

### A note on versions

The build brief asked for Next 16.3, expecting it to be stable by now. It isn't — `npm view next version` returns **16.2.12**, and 16.3 is not on `latest`. This is pinned to 16.2.12 rather than using `@preview` or `@canary`. Everything the brief asked for in §1.1 exists in 16.2:

- **`proxy.ts`** is supported (`PROXY_FILENAME` is in `next/dist/lib/constants`) and is what gates `/admin` — no `middleware.ts` fallback was needed.
- **`cacheComponents`** and **`typedRoutes`** are both top-level config options now, not `experimental.*`.
- `params`, `searchParams`, `cookies()` and `headers()` are async throughout.

Two APIs did change from what the brief described, and the newer form is used:

- **`revalidateTag(tag, profile)`** now takes a cache profile as a second argument. Route handlers call `revalidateTag(galleryTag(slug), 'max')`.
- **`updateTag(tag)`** is the Server Action equivalent, and gives read-your-own-writes. `app/admin/actions.ts` uses it so a redirect straight after saving never shows stale data.

TypeScript 7.0.2 exists (the Go-based compiler), but the brief specified "latest 5.x", so this pins **5.9.3**.

---

## Setup

Full click-by-click walkthrough, including which dashboard screens to open: **[SETUP-TASKS.md](./SETUP-TASKS.md)**. Short version:

### 1. Install

```bash
nvm use            # Node 24
corepack enable pnpm
pnpm install
```

### 2. Supabase

Create a project at [supabase.com](https://supabase.com) → **Project Settings → API**, and copy the URL, the anon key and the service-role key into `.env.local`. Grab the connection string from **Settings → Database** as `SUPABASE_DB_URL`.

Then, in **Authentication**:
- turn **"Confirm email" off** (there is no public signup, so confirmation mail would just block you)
- turn **"Allow new users to sign up" off** — this is what enforces the single-admin rule

```bash
pnpm migrate   # creates tables, RLS policies, triggers
pnpm seed      # creates the admin user + a demo gallery
```

`pnpm seed` is safe to re-run — it updates the existing admin's password rather than failing, so it doubles as a password reset.

### 3. Cloudflare R2

Create a bucket, an **Object Read & Write** API token scoped to that bucket, and enable the **Public Development URL**. Copy the five `R2_*` values into `.env.local`.

Then set the bucket's **CORS policy** — the browser PUTs compressed files straight to R2, so without this every upload fails with an opaque error:

```json
[{
  "AllowedOrigins": ["http://localhost:3000", "https://YOUR-APP.vercel.app"],
  "AllowedMethods": ["GET", "PUT", "HEAD"],
  "AllowedHeaders": ["content-type", "content-length", "x-amz-*"],
  "ExposeHeaders": ["etag"],
  "MaxAgeSeconds": 3600
}]
```

> The `pub-*.r2.dev` URL is rate-limited by Cloudflare and isn't meant for production traffic. Attach a custom domain (free, in the bucket's settings) before sharing a gallery widely, and point `R2_PUBLIC_BASE_URL` at it.

### 4. Run

```bash
pnpm dev       # http://localhost:3000
```

`/admin/login` with the seeded credentials. Delete `ADMIN_PASSWORD` from `.env.local` afterwards.

### 5. Deploy

Import the repo on Vercel, paste every env var except `SUPABASE_DB_URL` and `ADMIN_PASSWORD`, deploy, then add the real `.vercel.app` origin to the R2 CORS policy. `vercel.json` already registers the nightly reconciliation cron.

---

## Scripts

| | |
|---|---|
| `pnpm dev` | Dev server (regenerates the inlined engine source first) |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm migrate` | Apply `supabase/migrations/*.sql`, tracked in `_migrations` |
| `pnpm seed` | Create the admin user and demo gallery |
| `pnpm smoke` | Headless test of the ported engine (jsdom) |
| `pnpm reconcile` | Run the storage reconciliation by hand |

---

## How it fits together

### The compression pipeline

This is the part that makes the whole thing free.

```
pick file
  → validate (type, size, duration, dimensions)      client, instant
  → decode + re-encode                               client
       images: createImageBitmap → OffscreenCanvas → WebP   (Web Worker, 2 max)
       video : one playback pass → two VideoEncoders → mp4-muxer
               fallback: ffmpeg.wasm
  → verify output is under its cap                   client
  → presigned PUT of the COMPRESSED renditions only  → R2
  → server HEADs each key, compares ACTUAL bytes     server
  → status = 'ready'
```

A 4 GB wedding shoot becomes about 180 MB of uploads. The browser does the CPU work instead of a serverless function, so there's no Vercel timeout and no 250 MB bundle to fight — an ffmpeg binary alone is ~80 MB.

Specific things worth knowing:

- **HEIC** (the iPhone default) can't be decoded by `<canvas>` in Chrome at all. It's detected and converted with `heic-to` before the canvas step.
- **Images run in a Web Worker**, capped at two. Compression is CPU-bound, so more workers than that just fight over cores.
- **Video runs on the main thread**, because decoding needs an `HTMLVideoElement` and workers don't have one. That's fine in practice: `VideoEncoder` does its work on its own threads, so the only main-thread cost is one `drawImage` per frame. A single playback pass feeds both encoders — the 720p silent loop and the 1080p lightbox copy — so a 10-second clip costs about 10 seconds, not 20.
- **Presigned PUTs bind `Content-Length` into the signature**, so R2 rejects a wrong-sized upload before storing a byte. The commit endpoint HEADs every key anyway and writes the *actual* stored size to the database, because the Supabase Storage driver can't bind a length.
- **Nothing is stored as uploaded.** The one exception is the server-side fallback for browsers that can't compress locally: it stages the original under `tmp/`, and deletes it the moment processing ends, succeed or fail. The nightly job sweeps anything left.

### Storage hygiene

Postgres can't delete an S3 object transactionally, so deleting a row **queues** its object keys into a `storage_deletions` outbox in the same transaction. The API route drains the queue immediately; the nightly cron drains anything a crashed request left behind, sweeps `processing` rows older than an hour, and diffs the whole bucket against the database to remove orphans. A deleted item can't leave a live object behind.

### Caching

`/g/[slug]` reads through a `'use cache'` function with `cacheLife('hours')` and a `gallery:{slug}` tag. Publishing, reordering, editing an item and deleting all invalidate that tag. Password-gated galleries deliberately skip the cached path entirely — they're read uncached, after the password check, so a cached copy of a private gallery can never be served.

### The engine

`lib/engine/engine.js` is the single source of truth. The Next app imports it; `scripts/build-engine-source.ts` inlines it (and its stylesheet) into a generated module so the static-export route can emit a genuinely self-contained `index.html` without reading from disk at runtime. The generator strips the one `export` keyword and refuses to run if the file has more than one top-level export, so the two can't drift.

The physics, wrap maths, drift, inertia (`friction = 0.93`), entrance stagger, cursor, filters and lightbox are unchanged from the reference. What changed, and only this:

1. `GALLERY` is injected from the server.
2. `--accent` / `--bg` come from the gallery record.
3. `object-position` is driven per item by `--focal`.
4. Videos use the poster and 720p loop in the grid, the 1080p copy in the lightbox.
5. **Single-play rule** — only the copy of a video nearest the viewport centre plays. This is a genuine bug in the reference file: the block is tiled up to 4×, so every video played up to four times at once, which iOS Safari silently refuses.
6. `<video>` elements only mount within one viewport of visible, and are torn down (decoder released) outside it.
7. `.tile-inner` carries an LQIP background so tiles are never flat grey before load.
8. Zero media still renders the reference's 40 striped placeholder tiles.
9. `prefers-reduced-motion` still disables drift and entrance.
10. `driftSpeed` / `density` multipliers, both defaulting to 1.0 — the reference feel exactly.

`pnpm smoke` mounts the engine in jsdom and asserts all of this, including that no video index ever plays twice.

### Static export

The export button produces a ZIP with one self-contained `index.html` and a `/media` folder — a round trip back to the format this started from. `/media` holds the **compressed renditions**, because originals are never stored. That's intended: the export is a faithful copy of what the site serves, not an archive of camera masters.

---

## Where free-tier limits could bite

Flagged in the code at each site, and summarised here:

| Service | Ceiling | What this build does about it |
|---|---|---|
| **R2 storage** | 10 GB | Account quota capped at 8 GB, per gallery 300 MB, enforced in a DB trigger. Storage meter in the admin header |
| **R2 egress** | free, unlimited | The reason media isn't in Supabase Storage |
| **R2 `pub-*.r2.dev`** | rate-limited by Cloudflare | Attach a custom domain before sharing widely — noted in `.env.example` and SETUP-TASKS |
| **R2 class-A ops** | 1M/month | The nightly reconciler LISTs ~1 call per 1000 keys. Nowhere near it |
| **Supabase DB** | 500 MB | Rows only; no media. Thousands of galleries would fit |
| **Supabase Storage** | 1 GB | Only relevant if you set `STORAGE_DRIVER=supabase`. ~3 galleries at the cap — noted in `lib/storage/supabase.ts` |
| **Vercel body limit** | 4 MB | Why compressed files PUT straight to R2 and never proxy through Next |
| **Vercel function duration** | 10s Hobby | Why compression is client-side. The server fallback declares `maxDuration = 60` and is off the request path via `after()` |
| **Vercel bundle** | 250 MB | Why `sharp` / `fluent-ffmpeg` are `serverExternalPackages`, and why the ffmpeg binary isn't expected to exist on Vercel |
| **Vercel cron** | 1/day Hobby | The reconciler runs nightly at 03:00 |

### Known limitations

- **Rate limiting is in-process.** On Vercel each instance has its own map and it resets on cold start, so the effective limit is per-instance. That's enough to stop a runaway upload loop burning R2 operations, which is what it's for. Swap the `Map` in `lib/ratelimit.ts` for Upstash Redis if you ever need a real distributed limit — the interface doesn't change.
- **Server-side video fallback needs a real ffmpeg binary**, which won't fit in a Vercel Hobby bundle. The route says so clearly instead of failing opaquely. In practice the browser path covers Chrome, Edge and Safari 17+, with ffmpeg.wasm behind it.
- **`next build` prints one Turbopack NFT warning** about `lib/server-process.ts` — it uses `os.tmpdir()` and `path.join`, which the tracer can't statically scope. It's a warning, not an error, and only affects that one fallback route's traced file list.

---

## Project layout

```
app/
  g/[slug]/            public gallery · list view · unlock · OG image
  admin/               login, gallery list, the 4-step wizard
  api/                 sign · commit · media CRUD · publish · export · cron
lib/
  engine/              engine.js + gallery.css — the ported reference
  compress/            preflight · image · video · worker · pool · upload
  storage/             adapter interface + R2 and Supabase implementations
  limits.ts            every number from §2 of the brief, in one place
supabase/migrations/   schema · triggers · RLS
scripts/               migrate · seed · reconcile · engine inliner · smoke test
reference/             the original gallery.html, for diffing
```

`lib/limits.ts` and `supabase/migrations/0002_triggers.sql` both hold the limits. The database is the authoritative enforcement point; the TypeScript module is what the UI and API routes read. Change one, change the other.

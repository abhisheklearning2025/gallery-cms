# SETUP TASKS — what I need from you

Everything below is free tier. No card required for Supabase. **Cloudflare R2 does ask for a card** even on the free 10 GB plan — that is the one unavoidable card entry. If you'd rather not, tell me and I'll flip the storage adapter default to Supabase Storage (1 GB free, no card) — the code supports it by changing one env var.

Work through these in order. Paste the results into `.env.local` (I've created it with every key blank) or just paste them back to me in chat.

---

## Task 1 — Supabase project (~5 min)

1. Go to https://supabase.com → sign in with GitHub → **New project**.
2. Organization: personal. Project name: `infinite-gallery`. Region: **Mumbai (ap-south-1)** — closest to you, lowest latency.
3. Set a database password. **Save it in your password manager** — you need it for the migration step and Supabase won't show it again.
4. Wait ~2 min for provisioning.
5. Go to **Project Settings → API keys**. Copy these three:

| Where in dashboard | Env var | Looks like |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | `https://abcdefgh.supabase.co` |
| Publishable / anon key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGci...` or `sb_publishable_...` |
| Secret / service_role key | `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGci...` or `sb_secret_...` |

> ⚠️ The service_role key bypasses all row-level security. It is server-only, never prefixed `NEXT_PUBLIC_`, and must never be pasted anywhere public. If you ever leak it, rotate it in the same screen.

6. Go to **Project Settings → Database → Connection string → URI**, copy it, and replace `[YOUR-PASSWORD]` with the password from step 3:

| Env var | Notes |
|---|---|
| `SUPABASE_DB_URL` | `postgresql://postgres.xxxx:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` — used only by the migration script |

7. **Auth → Providers → Email**: turn **"Confirm email" OFF** (there's no public signup; the admin is seeded directly, and confirmation mail would just block you).
8. **Auth → Sign In / Providers**: turn **"Allow new users to sign up" OFF**. This is the switch that enforces §4's "no public signup".

---

## Task 2 — Cloudflare R2 bucket (~8 min)

1. Go to https://dash.cloudflare.com → sign up / sign in.
2. Left sidebar → **R2 Object Storage** → **Purchase R2 plan** (this is the card step; the free tier is 10 GB storage, 1 M class-A ops, 10 M class-B ops, **$0 egress** — you won't be billed unless you exceed it).
3. **Create bucket**. Name: `infinite-gallery`. Location: **Asia-Pacific (APAC)**. Storage class: Standard.
4. Copy your **Account ID** — it's on the R2 overview page right sidebar, and also in the URL `dash.cloudflare.com/<ACCOUNT_ID>/r2`.

| Env var | Value |
|---|---|
| `R2_ACCOUNT_ID` | the 32-char hex account id |
| `R2_BUCKET` | `infinite-gallery` |

5. **R2 → API → Manage API tokens → Create API token**:
   - Token name: `gallery-cms`
   - Permissions: **Object Read & Write**
   - Specify bucket: `infinite-gallery` only (not "all buckets")
   - TTL: forever
   - Create, then copy **Access Key ID** and **Secret Access Key**. The secret is shown **once**.

| Env var | Value |
|---|---|
| `R2_ACCESS_KEY_ID` | ~32 chars |
| `R2_SECRET_ACCESS_KEY` | ~64 chars |

6. **Public access** — the gallery serves media straight from R2, so the bucket needs a public read URL. Bucket → **Settings → Public Development URL → Enable**. You get `https://pub-<hash>.r2.dev`.

| Env var | Value |
|---|---|
| `R2_PUBLIC_BASE_URL` | `https://pub-xxxxxxxx.r2.dev` |

> ⚠️ **The r2.dev dev URL is rate-limited by Cloudflare and is explicitly not for production traffic.** It's fine for building and for showing the gallery to a few people. Before you send the link to a wedding-sized guest list, connect a custom domain (Bucket → Settings → Custom Domains → add e.g. `media.yourdomain.com`) and change `R2_PUBLIC_BASE_URL` to that. Custom domain on R2 is free and removes the rate limit. If you don't own a domain yet, that's the only thing this build needs that you don't have.

7. **CORS** — the browser uploads compressed files directly to R2 via presigned PUT, so R2 must accept cross-origin PUTs. Bucket → **Settings → CORS policy → Add CORS policy**, paste:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://YOUR-APP.vercel.app"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type", "content-length", "x-amz-*"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace `YOUR-APP.vercel.app` once you've deployed. **Uploads will fail with an opaque CORS error if you skip this step** — it's the single most common thing to get wrong.

---

## Task 3 — admin account (~1 min, after you send me the keys)

Decide these two now:

| Env var | Value |
|---|---|
| `ADMIN_EMAIL` | the email you'll log in with |
| `ADMIN_PASSWORD` | 12+ chars, used once by the seed script, then delete it from `.env.local` |

I run `pnpm seed` — it creates that user via the Supabase admin API and builds a demo gallery with 40 placeholder tiles so you can see the wall immediately, before uploading anything.

---

## Task 4 — Vercel (~3 min, only when you want it live)

1. https://vercel.com → sign in with GitHub → **Add New → Project** → import the `gallery-cms` repo.
2. Framework preset: Next.js (auto-detected). Build command and output: leave default.
3. **Settings → Environment Variables**: paste every var from `.env.local` **except** `SUPABASE_DB_URL` and `ADMIN_PASSWORD` (those are local-only).
4. Deploy. Then go back to Task 2 step 7 and add the real `.vercel.app` origin to the R2 CORS policy.

> Vercel Hobby free-tier ceilings that matter here: 100 GB bandwidth/month, 4 MB serverless request body (which is exactly why the compressed files are PUT straight to R2 and never proxied through Next), 10 s function duration on Hobby. The build is designed to stay inside all three.

---

## Summary — the 11 values I need

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
R2_ACCOUNT_ID=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_PUBLIC_BASE_URL=
ADMIN_EMAIL=
ADMIN_PASSWORD=
```

Until these exist the app still runs — `pnpm dev` boots, the admin UI renders, and the public gallery shows the placeholder wall. Anything that touches the database or storage will show a clear "not configured" error rather than crashing.

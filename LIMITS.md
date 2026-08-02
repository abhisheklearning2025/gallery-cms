# LIMITS

Hand this to whoever is uploading the media. Everything here falls out of how the wall actually renders — none of it is arbitrary.

---

## How many items

The wall builds one block of tiles from your media, then tiles that block about 2×2 to cover the screen. **Every photo is on screen up to four times at once.** That's what makes the repetition visible when there are too few.

| | Count | Why |
|---|---|---|
| Absolute minimum | **12** | Below this the repeat is obvious and it stops feeling infinite |
| Comfortable minimum | **24** | Repeats get hard to spot while dragging |
| **Sweet spot** | **40–60** | The grid maths lands cleanly here |
| Soft maximum | **80** | 80 unique → ~320 live tiles. Still smooth, but that's the ceiling |
| Hard maximum | **120** | Above this, first paint and drag FPS degrade on mid-range phones. The app blocks it |

## Videos — the real constraint

Videos autoplay muted and loop whenever they're on screen. Because the block is duplicated four times, **6 unique videos used to mean up to 24 `<video>` elements at once**. Safari desktop caps concurrent decodes around 16; iOS Safari is far stricter and silently refuses beyond a handful.

This build fixes that: **only the copy nearest the middle of the screen plays**, and video elements outside one screen's distance are torn down entirely. Even so:

| | |
|---|---|
| Recommended | **4–8 unique videos** |
| Hard cap | **12** — the app refuses to save past this |
| Share of the wall | keep video **under 20%** of total items |
| Best source | 1080p, **5–12 seconds**, subject centred, steady |

Only the first **12 seconds** of any clip loops on the wall. The full clip stays available in the lightbox.

---

## Sizes and cropping

Each item gets a size — `s`, `m`, `l`, `xl`. Default mix on bulk upload is **25% s · 40% m · 25% l · 10% xl**, and never more than two `xl` in a row.

**Every photo gets cropped.** The engine assigns one of six aspect ratios per tile position (3:4, 1:1, 4:3, 16:10, 4:5, 5:4) and covers the tile, and the same photo lands on different ratios in different places. You can't choose the ratio — but you can set a **focal point** per item, and the crop preview shows all six shapes at once.

Anything more extreme than 9:16 or 16:9 will lose a lot. The uploader warns about those.

---

## File limits

### Before compression — rejected immediately

| | Limit |
|---|---|
| Photo file | 50 MB |
| Video file | 500 MB |
| Video length | 90 seconds |
| Minimum photo long edge | 800 px (warns, still allows) |
| Accepted | JPEG · PNG · WebP · AVIF · **HEIC/HEIF** · MP4 · MOV · WebM |

HEIC works — iPhone photos convert in the browser automatically.

### After compression — what's actually stored

Nothing is ever stored as you uploaded it. Your browser re-encodes every file before a byte leaves the device.

| Rendition | Spec | Target | Hard reject |
|---|---|---|---|
| Photo, grid | 1200 px WebP q75 | ≤ 120 KB | 400 KB |
| Photo, lightbox | 2400 px WebP q82 | ≤ 350 KB | 1 MB |
| Video poster | JPEG at 1s, 1200 px | ≤ 100 KB | 300 KB |
| Video loop (the wall) | 720p, CRF 26, **no audio**, ≤12s | ≤ 2.5 MB | 5 MB |
| Video full (lightbox) | 1080p, CRF 22, audio kept | ≤ 20 MB | 20 MB |
| **One item, all renditions** | — | — | **25 MB** |

Grid videos never render above about 850 device pixels, so 720p is already oversampled. Stripping the audio from the loop is what makes autoplay reliable across browsers — that's not a quality compromise, it's the reason it plays at all.

If something comes out over its cap, the app **retries automatically** at lower quality, up to three passes, before giving up:

```
video full:  CRF 22 @1080p  →  CRF 26 @1080p  →  CRF 28 @720p  →  reject
photo full:  q82            →  q72            →  q62 @1800px   →  reject
```

A rejection tells you what to do about it — *"clip.mp4 is still 26 MB after three compression passes — it's 74 s long. Trim it to under 30 s and try again."*

---

## Storage quotas

| | Limit |
|---|---|
| Per gallery | **300 MB**, 120 items |
| Per account | **8 GB** (2 GB of headroom under Cloudflare R2's 10 GB free tier) |

Uploads stop at 95% of the account quota. The header shows how much is used.

---

## Page budget

The first screen must come in **under 4 MB** and be interactive within **2.5 seconds on 4G**. The preview step reports the estimate before you publish.

If it's over: remove a video. One video loop is worth roughly twenty photos.

---

## Accessibility

Every photo needs **alt text** — the database enforces it, so an image can't go live without it. The uploader seeds it from the filename; edit it to something useful.

Every gallery also has a plain, keyboard-navigable list view at `/g/<your-slug>/list` for screen readers. A drag-to-explore canvas isn't operable without a pointer, so that page is the real fallback, not a courtesy.

Anyone with reduced-motion enabled gets the wall with no drift and no entrance animation, automatically.

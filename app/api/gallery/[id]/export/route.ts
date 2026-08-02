import JSZip from 'jszip';
import { route, requireUser, requireOwnedGallery, ApiError } from '@/lib/api';
import { loadGalleryById } from '@/lib/gallery-data';
import { ENGINE_JS, ENGINE_CSS } from '@/lib/engine/generated-source';
import { formatBytes } from '@/lib/limits';
import type { PublicMediaItem } from '@/lib/types';

export const maxDuration = 60;

/**
 * §6.10 — "download a ZIP containing a single self-contained index.html plus a
 * /media folder, i.e. round-trip back to the format I started with, so I'm
 * never locked in."
 *
 * The engine and its stylesheet are inlined from the same source the app runs
 * (lib/engine/engine.js, via the generated module), so the export can never
 * drift from the live site.
 *
 * Note: /media holds the COMPRESSED renditions, because originals are never
 * stored (§2.7). That's the intended behaviour — the export is a faithful copy
 * of what the site serves, not an archive of camera masters.
 */
export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const gallery = await requireOwnedGallery(id, user.id);

  const loaded = await loadGalleryById(id);
  if (!loaded || loaded.media.length === 0) {
    throw new ApiError('There’s nothing to export yet — add some media first.', 400);
  }

  const zip = new JSZip();
  const media = zip.folder('media');
  if (!media) throw new ApiError('Could not build the archive.', 500);

  const exported: Record<string, unknown>[] = [];
  let bytes = 0;

  for (const [i, item] of loaded.media.entries()) {
    const n = String(i + 1).padStart(2, '0');
    const entry: Record<string, unknown> = {
      kind: item.kind,
      size: item.size,
      tag: item.tag,
      alt: item.alt,
      focalX: item.focalX,
      focalY: item.focalY,
      lqip: item.lqip,
    };

    for (const [rendition, url] of [
      ['grid', item.gridUrl],
      ['full', item.fullUrl],
      ['poster', item.posterUrl],
    ] as const) {
      if (!url) continue;
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      bytes += buf.byteLength;

      const ext = url.split('.').pop()?.split('?')[0] ?? 'bin';
      const name = `${n}-${rendition}.${ext}`;
      media.file(name, buf);
      entry[`${rendition}Url`] = `media/${name}`;
    }

    exported.push(entry);
  }

  const config = {
    title: gallery.title,
    tagline: gallery.tagline,
    accent: gallery.accent,
    bg: gallery.bg,
    driftSpeed: Number(gallery.drift_speed),
    density: Number(gallery.density),
    showFilters: gallery.show_filters,
    media: exported,
  };

  zip.file('index.html', buildHtml(gallery.title, config));
  zip.file('README.txt', readme(gallery.slug, loaded.media, bytes));

  const blob = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return new Response(blob as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${gallery.slug}.zip"`,
      'Content-Length': String(blob.byteLength),
    },
  });
});

function buildHtml(title: string, config: unknown): string {
  // </script> inside the JSON would close the tag early.
  const json = JSON.stringify(config).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>

<!--
  Exported from Infinite Gallery. Everything is in this one file except the
  media, which lives in ./media next to it.

  To change the wall, edit the GALLERY object below: title, tagline, accent,
  bg, and one entry per photo or video. Any static host will serve this —
  or just open it in a browser.
-->

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

<style>
${ENGINE_CSS}
</style>
</head>
<body>
<div id="gallery"></div>

<script>
const GALLERY = ${json};
</script>

<script>
${ENGINE_JS}
mountGallery(document.getElementById('gallery'), GALLERY);
</script>
</body>
</html>
`;
}

function readme(slug: string, media: PublicMediaItem[], bytes: number): string {
  const videos = media.filter((m) => m.kind === 'video').length;
  return `${slug} — exported gallery
${'='.repeat(slug.length + 20)}

  index.html   the whole site: markup, styles and the engine, in one file
  media/       ${media.length} items (${media.length - videos} photos, ${videos} videos), ${formatBytes(bytes)}

Open index.html in a browser — there is no build step and no server needed.
To host it, upload both index.html and media/ to any static host.

These are the compressed renditions the site serves, not your original files.
Grid images are 1200px WebP; lightbox images are 2400px; video loops are 720p
with the audio stripped (that's what makes autoplay work), and the lightbox
copies are 1080p with audio.

To edit: open index.html and change the GALLERY object near the bottom.
Each entry takes kind, gridUrl, fullUrl, posterUrl, size (s/m/l/xl), tag, alt
and focalX/focalY.
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

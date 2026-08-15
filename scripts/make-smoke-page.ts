import { writeFileSync } from 'node:fs';
import { ENGINE_JS, ENGINE_CSS } from '../lib/engine/generated-source';

const OUT = process.argv[2];

// Two pages: the empty-state placeholder wall, and one with real media
// (picsum stand-ins) exercising images, videos, focal points and LQIP.
const withMedia = process.argv[3] === 'media';

// Mixed orientations on purpose. Tiles take their shape from the photo, so a
// fixture of uniform 4:3 landscapes would pass no matter how that code behaved
// -- it has to contain portraits, squares and an over-wide panorama to be worth
// running. The panorama is past the engine's 2:1 clamp, so it also covers the
// one case that still legitimately crops.
const SHAPES: [number, number][] = [
  [1200, 1800], // 2:3 portrait, the common phone shot
  [1800, 1200], // 3:2 landscape
  [1200, 1200], // square
  [1080, 1920], // 9:16 tall
  [2400, 1000], // 12:5 panorama, wider than the clamp
];

const media = withMedia
  ? Array.from({ length: 24 }, (_, i) => {
      const [w, h] = SHAPES[i % SHAPES.length];
      const isVideo = i % 6 === 0;
      return {
        kind: isVideo ? 'video' : 'image',
        gridUrl: isVideo
          ? 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4'
          : `https://picsum.photos/seed/g${i}/${w}/${h}`,
        fullUrl: isVideo ? null : `https://picsum.photos/seed/g${i}/${w * 2}/${h * 2}`,
        posterUrl: isVideo ? `https://picsum.photos/seed/p${i}/${w}/${h}` : null,
        width: w,
        height: h,
        size: ['s', 'm', 'l', 'xl'][i % 4],
        tag: `tile ${i + 1}`,
        alt: `Test image ${i + 1}`,
        focalX: 50,
        focalY: 40,
      };
    })
  : [];

const config = {
  title: 'Abhishek & Krati',
  tagline: '12 · 11 · 2025 · Jaipur',
  accent: '#5A6CFF',
  bg: '#0E0E11',
  driftSpeed: 1,
  density: 1,
  showFilters: true,
  media,
};

writeFileSync(
  OUT,
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${config.title}</title>
<style>${ENGINE_CSS}</style></head><body>
<div id="gallery"></div>
<script>window.GALLERY = ${JSON.stringify(config)};</script>
<script>
window.__errors = [];
window.onerror = (m,s,l,c,e) => window.__errors.push(String(m));
${ENGINE_JS}
mountGallery(document.getElementById('gallery'), GALLERY);
console.log('[test] mounted, tiles =', document.querySelectorAll('.tile').length);
</script></body></html>`,
);
console.log('wrote', OUT, 'media items:', media.length);

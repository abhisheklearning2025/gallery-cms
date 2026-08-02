import { writeFileSync } from 'node:fs';
import { ENGINE_JS, ENGINE_CSS } from '../lib/engine/generated-source';

const OUT = process.argv[2];

// Two pages: the empty-state placeholder wall, and one with real media
// (picsum stand-ins) exercising images, videos, focal points and LQIP.
const withMedia = process.argv[3] === 'media';

const media = withMedia
  ? Array.from({ length: 24 }, (_, i) => ({
      kind: i % 6 === 0 ? 'video' : 'image',
      gridUrl:
        i % 6 === 0
          ? 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4'
          : `https://picsum.photos/seed/g${i}/1200/900`,
      fullUrl: i % 6 === 0 ? null : `https://picsum.photos/seed/g${i}/2400/1800`,
      posterUrl: i % 6 === 0 ? `https://picsum.photos/seed/p${i}/1200/900` : null,
      size: ['s', 'm', 'l', 'xl'][i % 4],
      tag: `tile ${i + 1}`,
      alt: `Test image ${i + 1}`,
      focalX: 50,
      focalY: 40,
    }))
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
<script>const GALLERY = ${JSON.stringify(config)};</script>
<script>
window.__errors = [];
window.onerror = (m,s,l,c,e) => window.__errors.push(String(m));
${ENGINE_JS}
mountGallery(document.getElementById('gallery'), GALLERY);
console.log('[test] mounted, tiles =', document.querySelectorAll('.tile').length);
</script></body></html>`,
);
console.log('wrote', OUT, 'media items:', media.length);

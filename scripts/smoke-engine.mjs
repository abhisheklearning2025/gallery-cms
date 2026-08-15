/**
 * Headless smoke test for the ported engine. Verifies it mounts, builds the
 * expected tile field, honours the empty state, applies focal points and LQIP,
 * runs the drift/wrap loop, and applies the single-play rule for videos.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(process.argv[2], 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost:8899/',
  // Stubs must exist before the page scripts parse, not after.
  beforeParse(window) {
    window.matchMedia = (q) => ({
      matches: false,
      media: q,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      writable: true,
      value: true,
    });
    window.HTMLMediaElement.prototype.play = function () {
      this.paused = false;
      return Promise.resolve();
    };
    window.HTMLMediaElement.prototype.pause = function () {
      this.paused = true;
    };
    window.HTMLMediaElement.prototype.load = function () {};
    window.HTMLElement.prototype.setPointerCapture = function () {};
    window.HTMLVideoElement.prototype.requestVideoFrameCallback = function () {};
  },
});

const { window } = dom;

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));

await new Promise((r) => setTimeout(r, 400));

const doc = window.document;
const root = doc.getElementById('gallery');

const results = [];
const check = (name, pass, detail = '') =>
  results.push({ name, pass, detail });

check('mounted (.ig class applied)', root?.classList.contains('ig'));
check('stage + board exist', !!root.querySelector('[data-stage]') && !!root.querySelector('[data-board]'));

const tiles = root.querySelectorAll('.tile');
check('tiles rendered', tiles.length > 0, `${tiles.length} tiles`);

// Every tile must carry a transform from the very first render().
const transformed = [...tiles].filter((t) => t.style.transform.includes('translate3d'));
check('all tiles positioned', transformed.length === tiles.length, `${transformed.length}/${tiles.length}`);

const wordmark = root.querySelector('[data-wordmark]');
check('title rendered', wordmark?.textContent.includes('Abhishek'), wordmark?.textContent?.trim());

const count = root.querySelector('[data-count]');
check('count rendered', /\d+ items/.test(count?.textContent ?? ''), count?.textContent);

const filters = root.querySelectorAll('[data-filters] button');
check('filters rendered', filters.length === 3);

// Top-level `const` in a classic script isn't a window property.
const mediaCount = window.eval('GALLERY.media.length');
if (mediaCount === 0) {
  const placeholders = root.querySelectorAll('.ph');
  check('empty state uses striped placeholders', placeholders.length === tiles.length, `${placeholders.length}`);
  // The reference wall is 40 slots: 34 photos, 6 videos.
  const uniq = new Set([...tiles].map((t) => t.dataset.media));
  check('empty state has 40 unique slots', uniq.size === 40, `${uniq.size}`);
  const vids = [...tiles].filter((t) => t.dataset.kind === 'video');
  const uniqVids = new Set(vids.map((t) => t.dataset.media));
  check('empty state has 6 unique video slots', uniqVids.size === 6, `${uniqVids.size}`);
} else {
  const imgs = root.querySelectorAll('img.media');
  check('images mounted', imgs.length > 0, `${imgs.length}`);

  const focal = [...root.querySelectorAll('.tile-inner')].filter((el) =>
    el.getAttribute('style')?.includes('--focal'),
  );
  check('focal point applied to every tile', focal.length === tiles.length, `${focal.length}/${tiles.length}`);

  const tagged = root.querySelectorAll('.tile-tag');
  check('hover captions rendered', tagged.length === tiles.length, `${tagged.length}`);

  const alts = [...imgs].filter((i) => i.getAttribute('alt'));
  check('alt text present on images', alts.length === imgs.length, `${alts.length}/${imgs.length}`);

  const badges = root.querySelectorAll('.vbadge');
  check('video badges rendered', badges.length > 0, `${badges.length}`);

  // Single-play rule: at most one <video> element per media index should be
  // unpaused after the visibility pass.
  await new Promise((r) => setTimeout(r, 400));
  const vids = [...root.querySelectorAll('video.media')];
  const playingByIndex = {};
  for (const v of vids) {
    const mi = v.closest('.tile')?.dataset.media;
    if (!v.paused) playingByIndex[mi] = (playingByIndex[mi] ?? 0) + 1;
  }
  const overlaps = Object.entries(playingByIndex).filter(([, n]) => n > 1);
  check(
    'single-play rule: no media index plays twice',
    overlaps.length === 0,
    `mounted videos: ${vids.length}, playing: ${JSON.stringify(playingByIndex)}`,
  );
}

// The drift loop must actually move the board.
const before = tiles[0].style.transform;
await new Promise((r) => setTimeout(r, 350));
const after = tiles[0].style.transform;
check('idle drift is moving tiles', before !== after, `${before} → ${after}`);

// Lightbox opens and closes.
//
// pointerup is dispatched on the STAGE, not the tile, because that is what a
// browser does: the stage calls setPointerCapture on pointerdown, and the
// Pointer Events spec then retargets every later event for that pointer to the
// capturing element. jsdom doesn't implement that retargeting, so firing
// pointerup on the tile here would test jsdom rather than a browser -- and it
// passed that way for a while against an engine whose lightbox could never
// actually open.
const lb = root.querySelector('[data-lb]');
const stage = root.querySelector('.stage');
tiles[0].dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1 }));
stage.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1 }));
check('lightbox opens on tap', lb.classList.contains('open'));
root.querySelector('[data-lb-x]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('lightbox closes', !lb.classList.contains('open'));

check('no uncaught errors', errors.length === 0, errors.join(' | '));

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? '  ✓' : '  ✗'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
window.close();
process.exit(failed.length ? 1 : 0);

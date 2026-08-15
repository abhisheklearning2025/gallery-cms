/* ===========================================================================
   Infinite Gallery — engine.

   This is the reference gallery.html engine, ported as-is. The physics, the
   wrap maths, the drift, the inertia (friction 0.93), the entrance stagger,
   the cursor, the filters and the lightbox are unchanged.

   What changed, and only this (§6):
     1. GALLERY is passed in rather than hardcoded.
     2. --accent / --bg come from the gallery record.
     3. object-position is driven per item by --focal.
     4. Videos use posterUrl + the 720p loop in the grid, the 1080p full in the
        lightbox.
     5. SINGLE-PLAY RULE: the block is tiled up to 4×, so a video used to exist
        up to 4 times and all copies played at once. Now only the copy nearest
        the viewport centre plays; the others show their poster. This is a real
        bug in the reference file — iOS Safari silently refuses to decode that
        many streams.
     6. <video> elements are only mounted within one viewport of the visible
        area, and are torn down (decoder released) when they drift outside it.
     7. tile-inner carries an LQIP background so tiles are never flat grey.
     8. Zero media still renders the reference's 40 striped placeholder tiles.
     9. prefers-reduced-motion still disables drift and entrance.
    10. driftSpeed / density multipliers from the gallery record.

   IMPORTANT: this file is the single source of truth for the engine. It is
   imported by the Next app AND inlined verbatim into the static-export HTML by
   scripts/build-engine-source.ts. Keep exactly one top-level `export function`
   in it — the generator strips that keyword to inline the file.
   =========================================================================== */

/**
 * @typedef {Object} IGMediaItem
 * @property {string}  [id]
 * @property {'image'|'video'} kind
 * @property {string|null} [gridUrl]
 * @property {string|null} [fullUrl]
 * @property {string|null} [posterUrl]
 * @property {string|null} [fallbackUrl]
 * @property {string|null} [lqip]
 * @property {'s'|'m'|'l'|'xl'} [size]
 * @property {string|null} [tag]
 * @property {string|null} [alt]
 * @property {number} [focalX]
 * @property {number} [focalY]
 *
 * @typedef {Object} IGConfig
 * @property {string}  [title]
 * @property {string}  [tagline]
 * @property {string}  [hint]
 * @property {string}  [accent]
 * @property {string}  [bg]
 * @property {number}  [driftSpeed]
 * @property {number}  [density]
 * @property {boolean} [showFilters]
 * @property {string}  [listHref]
 * @property {IGMediaItem[]} media
 */

/**
 * Mounts the gallery into `root`. Returns a teardown function.
 *
 * @param {HTMLElement} root
 * @param {IGConfig} GALLERY
 * @returns {() => void}
 */
export function mountGallery(root, GALLERY) {
  'use strict';

  const ac = new AbortController();
  const sig = { signal: ac.signal };
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  const touch = matchMedia('(hover:none)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const esc = (s) =>
    String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  /* ---- the 40-slot reference wall, used when a gallery has no media yet ---- */
  const PLACEHOLDERS = [
    ['image', 'l'], ['image', 's'], ['video', 'm'], ['image', 'm'],
    ['image', 'xl'], ['image', 's'], ['video', 'l'], ['image', 'm'],
    ['image', 's'], ['image', 'm'], ['image', 'l'], ['video', 'm'],
    ['image', 's'], ['image', 'xl'], ['image', 'm'], ['image', 's'],
    ['image', 'l'], ['image', 'm'], ['image', 'm'], ['video', 's'],
    ['image', 'l'], ['image', 's'], ['image', 'm'], ['image', 'xl'],
    ['image', 'm'], ['video', 'l'], ['image', 's'], ['image', 'm'],
    ['image', 'l'], ['image', 's'], ['image', 'm'], ['image', 'xl'],
    ['image', 'm'], ['video', 's'], ['image', 'l'], ['image', 'm'],
    ['image', 's'], ['image', 'l'], ['image', 'm'], ['image', 'xl'],
  ].map(([kind, size]) => ({ kind, size, gridUrl: null, fullUrl: null, posterUrl: null }));

  const cfg = GALLERY || { media: [] };
  const M = cfg.media && cfg.media.length ? cfg.media : PLACEHOLDERS;
  const isEmptyState = !(cfg.media && cfg.media.length);

  const driftMul = typeof cfg.driftSpeed === 'number' ? cfg.driftSpeed : 1;
  const densityMul = typeof cfg.density === 'number' ? cfg.density : 1;

  const playSVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

  /* ---- markup ------------------------------------------------------------ */
  root.classList.add('ig');
  if (cfg.accent) root.style.setProperty('--accent', cfg.accent);
  if (cfg.bg) root.style.setProperty('--bg', cfg.bg);

  root.innerHTML = `
    ${cfg.listHref ? `<a class="skip" href="${esc(cfg.listHref)}">Skip to list view</a>` : ''}
    <div class="grain"></div>
    <div class="glow"></div>
    <div class="stage" data-stage><div class="board" data-board></div></div>
    <div class="ui">
      <div class="bar">
        <div class="wordmark" data-wordmark>${esc(cfg.title || 'GALLERY')}<span>${esc(
          cfg.tagline || 'drag to explore',
        )}</span></div>
        ${
          cfg.showFilters === false
            ? ''
            : `<div class="filters" data-filters>
                 <button data-f="all" class="active">All</button>
                 <button data-f="image">Photos</button>
                 <button data-f="video">Video</button>
               </div>`
        }
      </div>
      <div class="hint" data-hint><span class="dot"></span> ${esc(
        cfg.hint || 'Drag, scroll or swipe · it never ends',
      )}</div>
      <div class="count" data-count></div>
    </div>
    <div class="cursor" data-cursor><b data-cursor-label></b></div>
    <div class="lb" data-lb>
      <button class="lb-x" data-lb-x aria-label="Close">&#10005;</button>
      <button class="lb-nav lb-prev" data-lb-prev aria-label="Previous">&#8249;</button>
      <div class="lb-inner" data-lb-inner></div>
      <button class="lb-nav lb-next" data-lb-next aria-label="Next">&#8250;</button>
      <div class="lb-idx" data-lb-idx></div>
    </div>`;

  const stage = $('[data-stage]');
  const board = $('[data-board]');
  const cursor = $('[data-cursor]');
  const cursorLabel = $('[data-cursor-label]');

  const SIZES = { s: 0.66, m: 0.92, l: 1.18, xl: 1.45 };
  const ASPECTS = [3 / 4, 1, 4 / 3, 16 / 10, 4 / 5, 5 / 4];
  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const base = () =>
    (touch ? Math.min(vw(), vh()) * 0.4 : Math.min(vw(), vh()) * 0.22) * densityMul;

  /* ---- one repeating block of tiles -------------------------------------- */
  let block = [];
  let BW = 0;
  let BH = 0;
  let cols = 0;
  let rows = 0;

  /**
   * A tile's shape comes from the photo it holds, so object-fit:cover has
   * nothing to crop. The reference picked from a fixed ASPECTS list by cell
   * index, which meant a portrait shot could land in a 16:10 tile and lose most
   * of itself.
   *
   * Clamped, because the wall is a grid of cells: one 3:1 panorama shouldn't be
   * allowed to flatten a whole row. Anything outside the range still crops, but
   * only that item, and only past 2:1. The ASPECTS fallback covers items with no
   * stored dimensions -- placeholders, and anything uploaded before width and
   * height were recorded.
   */
  const MIN_ASPECT = 0.5; // 1:2, taller than 9:16
  const MAX_ASPECT = 2.0; // 2:1, wider than 16:9

  /**
   * How much of its cell a tile is allowed to take. Lower packs the wall
   * tighter; the reference used 1.42, which reads as sparse now that tiles are
   * sized by area rather than stretched to the cell width.
   */
  const CELL = 1.28;

  function tileAspect(m, c) {
    const natural = m.width > 0 && m.height > 0 ? m.width / m.height : 0;
    if (!natural) return ASPECTS[(c * 7) % ASPECTS.length];
    return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, natural));
  }

  /**
   * The shape the grid should be built around: the median tile aspect, which
   * ignores the one panorama in a set of portraits rather than being dragged by
   * it the way a mean would. Falls back to square for the placeholder wall,
   * which has no stored dimensions and is laid out by the ASPECTS list.
   */
  function blockAspect() {
    const list = M.map((m) => (m.width > 0 && m.height > 0 ? m.width / m.height : 0))
      .filter((x) => x > 0)
      .map((x) => Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, x)))
      .sort((x, y) => x - y);
    if (!list.length) return 1;
    const mid = list.length >> 1;
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  function buildBlock() {
    const u = base();
    const n = M.length;

    // Cells take the shape of the photos they hold. Square cells holding 3:2
    // landscapes leave the tile filling ~79% of the width but only ~53% of the
    // height, and the random offset scatters that leftover into the horizontal
    // bands of dead space that made the wall look half empty.
    //
    // cellW * cellH is unchanged by the sqrt pair, so density is identical --
    // this only redistributes slack evenly instead of dumping all of it below
    // every tile.
    const a = blockAspect();
    const cellW = u * CELL * Math.sqrt(a);
    const cellH = (u * CELL) / Math.sqrt(a);

    // Choose columns so a block is roughly viewport-shaped: BW/BH works out to
    // cols^2 * a / n, so cols = sqrt(n * viewportAspect / a). At a = 1 this is
    // the reference's sqrt(n * aspect), so the placeholder wall is untouched.
    const aspect = vw() / vh();
    cols = Math.max(2, Math.round(Math.sqrt((n * aspect) / a)));
    rows = Math.ceil(n / cols);
    const cellCount = cols * rows;
    BW = cols * cellW;
    BH = rows * cellH;

    // Published so the layout invariant is checkable from outside: a tile whose
    // aspect matches the block's should leave equal slack on both axes. Without
    // this the only symptom of a mismatch is "it looks gappy".
    board.dataset.cellW = String(Math.round(cellW));
    board.dataset.cellH = String(Math.round(cellH));
    block = [];
    for (let c = 0; c < cellCount; c++) {
      const mi = c % n;
      const m = M[mi];
      const col = c % cols;
      const row = Math.floor(c / cols);
      const mult = SIZES[m.size] || Object.values(SIZES)[Math.floor(rand(0, 4))];
      const asp = tileAspect(m, c);

      // Size by AREA rather than width. Width-first (what the reference did)
      // gives a portrait tile far more visual weight than a landscape one at
      // the same size key, and every portrait then hit the height clamp and
      // came out identical, throwing away the s/m/l/xl mix entirely.
      const target = u * mult;
      let w = target * Math.sqrt(asp);
      let h = target / Math.sqrt(asp);

      // Shrink to fit the cell, preserving the aspect ratio exactly -- the old
      // code re-derived one edge from the other here, which quietly reshaped
      // the tile away from the photo it was holding.
      const fit = Math.min(1, (cellW * 0.94) / w, (cellH * 0.94) / h);
      w *= fit;
      h *= fit;
      const x = col * cellW + rand(0, Math.max(0, cellW - w));
      const y = row * cellH + rand(0, Math.max(0, cellH - h));
      block.push({ mi, x, y, w, h, kind: m.kind });
    }
  }

  /* ---- field: enough block-copies to cover the screen -------------------- */
  let nodes = [];
  let repX = 1;
  let repY = 1;
  let fieldW = 0;
  let fieldH = 0;

  function tileMarkup(m, b) {
    const focal = `--focal:${m.focalX == null ? 50 : m.focalX}% ${m.focalY == null ? 50 : m.focalY}%`;
    const lqip = m.lqip ? `background-image:url(${m.lqip});` : '';
    const label = esc(m.alt || m.tag || '');

    let inner;
    if (m.kind === 'video' && m.gridUrl) {
      // The poster is always in the DOM; the <video> is mounted on top of it
      // only when this copy is near the viewport (§6.6).
      inner = m.posterUrl
        ? `<img class="media" data-poster src="${esc(m.posterUrl)}" alt="${label}" loading="lazy" decoding="async">`
        : `<div class="ph">video</div>`;
      inner += `<span class="vbadge">${playSVG}</span>`;
    } else if (m.kind === 'image' && m.gridUrl) {
      const fb = m.fallbackUrl ? ` onerror="this.onerror=null;this.src='${esc(m.fallbackUrl)}'"` : '';
      inner = `<img class="media" src="${esc(m.gridUrl)}" alt="${label}" loading="lazy" decoding="async"${fb}>`;
    } else {
      inner = `<div class="ph">${b.kind === 'video' ? 'video' : 'photo'} ${String(b.mi + 1).padStart(2, '0')}</div>`;
    }

    return `<div class="tile-inner" style="${focal};${lqip}">${inner}${
      m.tag ? `<span class="tile-tag">${esc(m.tag)}</span>` : ''
    }</div>`;
  }

  function buildField() {
    dropAllVideos();
    buildBlock();
    repX = Math.ceil(vw() / BW) + 1;
    repY = Math.ceil(vh() / BH) + 1;
    fieldW = repX * BW;
    fieldH = repY * BH;
    board.innerHTML = '';
    nodes = [];
    const frag = document.createDocumentFragment();
    for (let ry = 0; ry < repY; ry++) {
      for (let rx = 0; rx < repX; rx++) {
        for (const b of block) {
          const m = M[b.mi];
          const tile = document.createElement('div');
          tile.className = 'tile';
          tile.style.width = b.w + 'px';
          tile.style.height = b.h + 'px';
          tile.dataset.media = String(b.mi);
          tile.dataset.kind = b.kind;
          tile.innerHTML = tileMarkup(m, b);
          frag.appendChild(tile);
          nodes.push({
            el: tile,
            inner: tile.querySelector('.tile-inner'),
            mi: b.mi,
            baseX: b.x + rx * BW,
            baseY: b.y + ry * BH,
            w: b.w,
            h: b.h,
            kind: b.kind,
            hasVideo: b.kind === 'video' && !!m.gridUrl,
            vid: null,
            _x: 0,
            _y: 0,
          });
        }
      }
    }
    board.appendChild(frag);
    render();
    entrance();
  }

  function entrance() {
    if (reduce) {
      nodes.forEach((nd) => nd.inner.classList.add('in'));
      return;
    }
    nodes.forEach((nd, i) => {
      nd.inner.style.transitionDelay = Math.min(i * 6, 650) + 'ms';
      requestAnimationFrame(() => requestAnimationFrame(() => nd.inner.classList.add('in')));
    });
    setTimeout(() => nodes.forEach((nd) => (nd.inner.style.transitionDelay = '')), 1500);
  }

  /* ---- video mounting + single-play rule --------------------------------- */
  function ensureVideo(nd) {
    if (nd.vid) return;
    const m = M[nd.mi];
    const v = document.createElement('video');
    v.className = 'media';
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.preload = 'metadata';
    if (m.posterUrl) v.poster = m.posterUrl;
    v.src = m.gridUrl;
    nd.inner.insertBefore(v, nd.inner.firstChild);
    nd.vid = v;
  }

  function dropVideo(nd) {
    if (!nd.vid) return;
    try {
      nd.vid.pause();
      nd.vid.removeAttribute('src');
      nd.vid.load();
    } catch {
      /* teardown is best-effort */
    }
    nd.vid.remove();
    nd.vid = null;
  }

  function dropAllVideos() {
    for (const nd of nodes) dropVideo(nd);
  }

  /* ---- physics: infinite + idle drift ------------------------------------ */
  let posX = 0;
  let posY = 0;
  let tX = 0;
  let tY = 0;
  let velX = 0;
  let velY = 0;
  let dragging = false;
  let moved = 0;
  let downTile = null;
  let lastX = 0;
  let lastY = 0;
  let lbOpen = false;
  const friction = 0.93;
  const wrap = (v, size) => ((v % size) + size) % size;

  const DRIFT_X = reduce ? 0 : -0.16 * driftMul;
  const DRIFT_Y = reduce ? 0 : -0.09 * driftMul;
  let idle = true;
  let idleT = null;
  function wake() {
    idle = false;
    clearTimeout(idleT);
    idleT = setTimeout(() => {
      idle = true;
    }, 2600);
  }

  let raf = 0;
  function tick() {
    if (!dragging) {
      tX += velX;
      tY += velY;
      velX *= friction;
      velY *= friction;
      if (Math.abs(velX) < 0.01) velX = 0;
      if (Math.abs(velY) < 0.01) velY = 0;
      if (idle && !lbOpen) {
        tX += DRIFT_X;
        tY += DRIFT_Y;
      }
    }
    const e = dragging ? 0.45 : 0.12;
    posX += (tX - posX) * e;
    posY += (tY - posY) * e;
    render();
    raf = requestAnimationFrame(tick);
  }

  let vt = 0;
  function render() {
    if (!fieldW) return;
    for (const nd of nodes) {
      const x = wrap(nd.baseX + posX + BW, fieldW) - BW;
      const y = wrap(nd.baseY + posY + BH, fieldH) - BH;
      nd._x = x;
      nd._y = y;
      nd.el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
    }

    // Visibility bookkeeping every 8th frame, as in the reference.
    if (vt++ % 8 === 0) {
      const W = vw();
      const H = vh();
      const cx = W / 2;
      const cy = H / 2;

      // best[mediaIndex] = the on-screen copy closest to the viewport centre.
      const best = new Map();

      for (const nd of nodes) {
        if (!nd.hasVideo) continue;

        // Mount only within one viewport of the visible area (§6.6).
        const near = nd._x + nd.w > -W && nd._x < 2 * W && nd._y + nd.h > -H && nd._y < 2 * H;
        if (near) ensureVideo(nd);
        else {
          dropVideo(nd);
          continue;
        }

        const onScreen = nd._x + nd.w > 0 && nd._x < W && nd._y + nd.h > 0 && nd._y < H;
        if (!onScreen) continue;

        const dx = nd._x + nd.w / 2 - cx;
        const dy = nd._y + nd.h / 2 - cy;
        const d = dx * dx + dy * dy;
        const prev = best.get(nd.mi);
        if (!prev || d < prev.d) best.set(nd.mi, { nd, d });
      }

      // Single-play rule: exactly one copy of each video plays (§2.3/§6.5).
      for (const nd of nodes) {
        if (!nd.vid) continue;
        const winner = best.get(nd.mi);
        if (winner && winner.nd === nd && !lbOpen) {
          if (nd.vid.paused) nd.vid.play().catch(() => {});
        } else if (!nd.vid.paused) {
          nd.vid.pause();
        }
      }
    }
  }

  /* ---- drag -------------------------------------------------------------- */
  stage.addEventListener(
    'pointerdown',
    (e) => {
      dragging = true;
      moved = 0;
      // Read the tile before setPointerCapture below makes the stage the target
      // of every remaining event for this pointer -- see endDrag.
      downTile = e.target.closest ? e.target.closest('.tile') : null;
      lastX = e.clientX;
      lastY = e.clientY;
      velX = velY = 0;
      wake();
      stage.setPointerCapture(e.pointerId);
      cursor.classList.add('drag');
    },
    sig,
  );

  stage.addEventListener(
    'pointermove',
    (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      tX += dx;
      tY += dy;
      velX = dx;
      velY = dy;
    },
    sig,
  );

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    cursor.classList.remove('drag');
    wake();
    if (moved < 6) {
      // DIVERGES FROM THE REFERENCE (reference/index.html:350), which reads
      // e.target.closest('.tile') off this pointerup and so can never open the
      // lightbox in a real browser: pointerdown calls stage.setPointerCapture,
      // and the Pointer Events spec retargets every later event for that
      // pointer to the capturing element. e.target here is always the stage,
      // and the stage is a tile's ancestor, so closest() always returns null.
      //
      // The press target is the reliable one -- capture is set inside the
      // pointerdown handler, after that event was already dispatched to the
      // tile. It's also the better semantic: the tile you pressed is the one
      // that opens, even if idle drift slid a different tile under the cursor.
      if (downTile) openLB(+downTile.dataset.media);
    }
    downTile = null;
  }
  stage.addEventListener('pointerup', endDrag, sig);
  stage.addEventListener(
    'pointercancel',
    () => {
      dragging = false;
      downTile = null;
      cursor.classList.remove('drag');
      wake();
    },
    sig,
  );

  /* ---- wheel / trackpad --------------------------------------------------- */
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      wake();
      tX -= e.deltaX;
      tY -= e.deltaY;
      velX = -e.deltaX * 0.2;
      velY = -e.deltaY * 0.2;
    },
    { passive: false, signal: ac.signal },
  );

  /* ---- custom cursor ------------------------------------------------------ */
  if (!touch) {
    window.addEventListener(
      'pointermove',
      (e) => {
        cursor.style.left = e.clientX + 'px';
        cursor.style.top = e.clientY + 'px';
      },
      { passive: true, signal: ac.signal },
    );
    root.addEventListener(
      'pointerover',
      (e) => {
        if (dragging) return;
        const onTile = e.target.closest('.tile');
        cursor.classList.toggle('ring', !!onTile);
        cursorLabel.textContent = onTile ? 'Open' : '';
      },
      sig,
    );
  }

  /* ---- hint --------------------------------------------------------------- */
  const hint = $('[data-hint]');
  let hidHint = false;
  function hideHint() {
    if (hidHint) return;
    hidHint = true;
    hint.style.opacity = '0';
  }
  stage.addEventListener('pointerdown', hideHint, { once: true, signal: ac.signal });
  stage.addEventListener('wheel', hideHint, { once: true, passive: true, signal: ac.signal });

  /* ---- filters ------------------------------------------------------------ */
  $$('[data-filters] button').forEach((b) => {
    b.addEventListener(
      'click',
      () => {
        $$('[data-filters] button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const f = b.dataset.f;
        nodes.forEach((nd) => nd.el.classList.toggle('dim', f !== 'all' && nd.kind !== f));
        updateCount(f);
      },
      sig,
    );
  });

  function updateCount(f = 'all') {
    const total = M.length;
    const photos = M.filter((m) => m.kind === 'image').length;
    const vids = total - photos;
    const n = f === 'image' ? photos : f === 'video' ? vids : total;
    $('[data-count]').textContent =
      n + (f === 'video' ? ' videos' : f === 'image' ? ' photos' : ' items');
  }

  /* ---- lightbox ----------------------------------------------------------- */
  const lb = $('[data-lb]');
  const lbInner = $('[data-lb-inner]');
  let cur = 0;

  function openLB(i) {
    cur = i;
    lbOpen = true;
    renderLB();
    lb.classList.add('open');
  }
  function closeLB() {
    lbOpen = false;
    lb.classList.remove('open');
    lbInner.innerHTML = '';
    wake();
  }
  function renderLB() {
    const m = M[cur];
    const src = m && (m.fullUrl || m.gridUrl);
    if (!m || !src) {
      lbInner.innerHTML = `<div style="font-family:var(--mono);font-size:.8rem;letter-spacing:.15em;color:var(--dim);text-transform:uppercase;padding:60px">${
        isEmptyState ? 'empty slot &middot; add a ' + (m ? m.kind : 'file') : 'still processing'
      }</div>`;
    } else if (m.kind === 'video') {
      lbInner.innerHTML =
        `<video src="${esc(src)}"${m.posterUrl ? ` poster="${esc(m.posterUrl)}"` : ''} controls autoplay playsinline></video>` +
        (m.tag ? `<div class="lb-cap">${esc(m.tag)}</div>` : '');
    } else {
      lbInner.innerHTML =
        `<img src="${esc(src)}" alt="${esc(m.alt || m.tag || '')}">` +
        (m.tag ? `<div class="lb-cap">${esc(m.tag)}</div>` : '');
    }
    $('[data-lb-idx]').textContent =
      String(cur + 1).padStart(2, '0') + ' / ' + String(M.length).padStart(2, '0');
  }
  function stepLB(d) {
    cur = (cur + d + M.length) % M.length;
    renderLB();
  }

  $('[data-lb-x]').addEventListener('click', closeLB, sig);
  $('[data-lb-prev]').addEventListener('click', () => stepLB(-1), sig);
  $('[data-lb-next]').addEventListener('click', () => stepLB(1), sig);
  lb.addEventListener(
    'click',
    (e) => {
      if (e.target === lb) closeLB();
    },
    sig,
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLB();
      if (e.key === 'ArrowRight') stepLB(1);
      if (e.key === 'ArrowLeft') stepLB(-1);
    },
    sig,
  );

  /* ---- resize ------------------------------------------------------------- */
  let rt;
  window.addEventListener(
    'resize',
    () => {
      clearTimeout(rt);
      rt = setTimeout(buildField, 220);
    },
    sig,
  );

  /* ---- go ----------------------------------------------------------------- */
  buildField();
  updateCount();
  raf = requestAnimationFrame(tick);

  return function destroy() {
    ac.abort();
    cancelAnimationFrame(raf);
    clearTimeout(idleT);
    clearTimeout(rt);
    dropAllVideos();
    root.innerHTML = '';
    root.classList.remove('ig');
  };
}

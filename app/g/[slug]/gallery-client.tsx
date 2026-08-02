'use client';

import { useEffect, useRef } from 'react';
import { mountGallery } from '@/lib/engine/engine.js';
import '@/lib/engine/gallery.css';
import type { PublicGalleryConfig } from '@/lib/types';

/**
 * The only client component on the public page. Everything inside is built by
 * the ported engine — React never owns the tile DOM, because the engine
 * transforms thousands of nodes per frame and a virtual DOM in that path would
 * cost frames on exactly the mid-range phones §7 cares about.
 */
export default function GalleryClient({
  config,
  listHref,
}: {
  config: PublicGalleryConfig;
  listHref?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const destroy = mountGallery(el, { ...config, listHref });
    return () => destroy();
  }, [config, listHref]);

  return <div ref={ref} suppressHydrationWarning />;
}

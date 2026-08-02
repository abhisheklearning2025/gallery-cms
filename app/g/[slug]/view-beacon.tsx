'use client';

import { useEffect } from 'react';

/**
 * View counting happens after paint, from the client, so it never runs during
 * render (which would be re-executed on every cache miss) and never blocks the
 * first frame of the wall.
 */
export default function ViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    const key = `ig_seen_${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // Private mode with storage disabled — count it anyway.
    }
    const t = setTimeout(() => {
      fetch(`/api/g/${encodeURIComponent(slug)}/view`, {
        method: 'POST',
        keepalive: true,
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [slug]);

  return null;
}

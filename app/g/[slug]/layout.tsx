import { Suspense } from 'react';

/**
 * cacheComponents is on, so anything that reads params/cookies needs a Suspense
 * boundary above it. The fallback is just the gallery's background colour —
 * the wall itself fades in via the engine's entrance stagger anyway.
 */
export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0E0E11' }} />}>
      {children}
    </Suspense>
  );
}

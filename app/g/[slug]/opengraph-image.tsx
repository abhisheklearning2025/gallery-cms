import { ImageResponse } from 'next/og';
import { getPublishedGallery } from '@/lib/gallery-data';

export const alt = 'Gallery';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * OG card: the wordmark over a 4-tile collage pulled from the gallery itself
 * (§4). Falls back to the striped placeholder look when a gallery has no media.
 */
export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await getPublishedGallery(slug);

  const title = found?.gallery.title ?? 'Gallery';
  const tagline = found?.gallery.tagline ?? 'drag to explore';
  const accent = found?.gallery.accent ?? '#5A6CFF';
  const bg = found?.gallery.bg ?? '#0E0E11';

  // Four evenly spaced picks so the card reflects the whole wall, not just its
  // opening tiles.
  const pool = (found?.media ?? []).filter((m) => m.gridUrl);
  const tiles = [0, 1, 2, 3]
    .map((i) => pool[Math.floor((i * pool.length) / 4)])
    .filter(Boolean)
    .slice(0, 4);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: bg,
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', width: '100%', height: '100%' }}>
          {tiles.length > 0
            ? tiles.map((t, i) => (
                <img
                  key={i}
                  src={(t.kind === 'video' ? t.posterUrl : t.gridUrl) ?? ''}
                  width={300}
                  height={630}
                  style={{ width: 300, height: 630, objectFit: 'cover', opacity: 0.55 }}
                />
              ))
            : [0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 300,
                    height: 630,
                    background:
                      i % 2 === 0
                        ? 'repeating-linear-gradient(45deg,#191920 0 10px,#15151a 10px 20px)'
                        : '#16161b',
                  }}
                />
              ))}
        </div>

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: 72,
            background: `linear-gradient(180deg, rgba(0,0,0,0.15) 0%, ${bg}f2 78%)`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: accent }} />
            <div
              style={{
                fontSize: 20,
                letterSpacing: 6,
                textTransform: 'uppercase',
                color: '#7c7a73',
              }}
            >
              {tagline}
            </div>
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, color: '#ECEAE4', letterSpacing: -1 }}>
            {title}
          </div>
        </div>
      </div>
    ),
    size,
  );
}

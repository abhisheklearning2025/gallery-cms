import type { NextConfig } from 'next';

const r2Host = (() => {
  try {
    return process.env.R2_PUBLIC_BASE_URL
      ? new URL(process.env.R2_PUBLIC_BASE_URL).hostname
      : undefined;
  } catch {
    return undefined;
  }
})();

const nextConfig: NextConfig = {
  // Next 16: both of these are top-level now, not `experimental`.
  cacheComponents: true,
  typedRoutes: true,

  // next/image is used for ADMIN THUMBNAILS ONLY. The public gallery uses raw
  // <img> because it lives inside a hand-rolled transform engine (see §6/§1.1).
  images: {
    remotePatterns: r2Host
      ? [{ protocol: 'https', hostname: r2Host }]
      : [
          // Allow any r2.dev dev-bucket until R2_PUBLIC_BASE_URL is configured.
          { protocol: 'https', hostname: '**.r2.dev' },
        ],
  },

  // sharp / fluent-ffmpeg are the *fallback* processing path only (§2.7). They
  // must never be bundled into the client or into edge runtimes.
  serverExternalPackages: ['sharp', 'fluent-ffmpeg', '@ffmpeg-installer/ffmpeg'],

  async headers() {
    return [
      {
        // The compression workers need these to use SharedArrayBuffer, which
        // ffmpeg.wasm (the no-WebCodecs fallback) requires.
        source: '/admin/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
};

export default nextConfig;

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

  // sharp's native addon reaches libvips through the OS dynamic linker (RPATH),
  // not through a JS require -- @img/sharp-libvips-linux-x64 is only ever named
  // as an optionalDependency of @img/sharp-linux-x64. The file tracer follows
  // requires, so it packs sharp-linux-x64.node and drops the library that addon
  // dlopens, and the function dies on first use with
  //   ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file
  // Nothing about the install is wrong; the files just never reach the bundle.
  // Only linux-x64 is listed because that is what Vercel runs -- the glob
  // matches nothing on a dev machine, which is correct, since local dev resolves
  // sharp straight out of node_modules.
  //
  // The glob is deliberately version-agnostic. Two libvips copies match (~32 MB
  // total: next/image pulls sharp 0.34.5, we depend on 0.35.3), which is well
  // inside Hobby's 250 MB and much safer than pinning a version that a lockfile
  // bump would silently stop matching -- the failure mode there is this same
  // runtime crash, with the config still looking correct.
  // The leading segment is matched with a single `*`, not `**`. pnpm fills
  // .pnpm/<pkg>/node_modules/ with symlinks between packages, and those form
  // cycles -- a `**` starting there can walk them forever. The only `**` left
  // is inside libvips's own lib/, which is a handful of real files and the
  // glib-2.0 headers.
  outputFileTracingIncludes: {
    '/api/media/process-fallback': [
      'node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/lib/**/*',
    ],
  },

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

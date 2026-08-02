import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-20">
      <p className="label mb-4">Infinite Gallery</p>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        An endless wall for your photographs.
      </h1>
      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[var(--color-dim)]">
        Drag in any direction and it never ends. Videos play only where you&apos;re looking. Upload a
        few dozen photos, pick a name, and it&apos;s live at a link you can text to anyone — every
        file compressed in your browser before it ever leaves the device.
      </p>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link href="/admin" className="btn btn-primary">
          Open admin
        </Link>
        <Link href="/g/demo" className="btn">
          See the demo wall
        </Link>
      </div>

      <div className="mt-16 border-t border-[var(--color-line)] pt-6">
        <p className="label mb-3">How it works</p>
        <ol className="space-y-2 text-sm text-[var(--color-dim)]">
          <li>1 — Name the gallery and pick a link.</li>
          <li>2 — Drop in 40–60 photos and 4–8 short clips.</li>
          <li>3 — Set sizes, crops and captions.</li>
          <li>4 — Publish. Share the link.</li>
        </ol>
      </div>
    </main>
  );
}

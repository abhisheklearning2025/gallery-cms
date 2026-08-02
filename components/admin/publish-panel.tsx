'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTS, PAGE_BUDGET, VIDEOS, formatBytes } from '@/lib/limits';

type Width = 'desktop' | 'tablet' | 'phone';

const WIDTHS: Record<Width, { w: number; h: number; label: string }> = {
  desktop: { w: 1440, h: 900, label: '1440 × 900' },
  tablet: { w: 834, h: 1112, label: '834 × 1112' },
  phone: { w: 390, h: 844, label: '390 × 844' },
};

export default function PublishPanel({
  gallery,
  stats,
  publicUrl,
  previewPath,
}: {
  gallery: {
    id: string;
    slug: string;
    title: string;
    status: 'draft' | 'published';
    visibility: string;
    totalBytes: number;
  };
  stats: { items: number; videos: number; firstScreenBytes: number; missingAlt: number };
  publicUrl: string;
  previewPath: string;
}) {
  const router = useRouter();
  const [width, setWidth] = useState<Width>('desktop');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const frameWrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const device = WIDTHS[width];

  // Scale the frame down to fit the column while keeping the *inner* viewport
  // at true device pixels — otherwise the engine would size itself to the
  // shrunken box and the preview would lie about tile density.
  useEffect(() => {
    const el = frameWrap.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / device.w));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [device.w]);

  useEffect(() => {
    if (gallery.status !== 'published') return;
    let cancelled = false;
    void (async () => {
      const QR = (await import('qrcode')).default;
      const url = await QR.toDataURL(publicUrl, {
        margin: 1,
        width: 240,
        color: { dark: '#ECEAE4', light: '#00000000' },
      });
      if (!cancelled) setQr(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [gallery.status, publicUrl]);

  const overBudget = stats.firstScreenBytes > PAGE_BUDGET.firstScreenBytes;

  async function publish(next: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/gallery/${gallery.id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish: next }),
    });
    setBusy(false);
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      warning?: string;
      url?: string;
    };
    if (!res.ok) {
      setError(body.error ?? 'Could not publish.');
      return;
    }
    setMessage(body.warning ?? (next ? 'Live.' : 'Unpublished — the link now 404s.'));
    router.refresh();
  }

  async function exportZip() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/gallery/${gallery.id}/export`);
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? 'Export failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${gallery.slug}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
      {/* ── live frame ─────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(Object.keys(WIDTHS) as Width[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setWidth(k)}
              className="btn px-2.5 py-1 text-xs"
              style={
                width === k
                  ? { borderColor: 'var(--color-accent)', background: 'var(--color-panel-2)' }
                  : undefined
              }
            >
              {k}
            </button>
          ))}
          <span className="label ml-1">{device.label}</span>
        </div>

        <div ref={frameWrap} className="overflow-hidden rounded-lg border border-[var(--color-line)]">
          <div
            style={{
              width: device.w,
              height: device.h,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              marginBottom: device.h * (scale - 1),
            }}
          >
            <iframe
              key={`${width}-${gallery.id}`}
              src={previewPath}
              title="Gallery preview"
              width={device.w}
              height={device.h}
              className="block border-0"
            />
          </div>
        </div>
      </section>

      {/* ── report + publish ───────────────────────────────────────────────── */}
      <aside className="space-y-5">
        <div className="card p-4">
          <p className="label mb-3">Weight report</p>
          <dl className="space-y-2 text-sm">
            <Row label="First screen" value={`≈ ${formatBytes(stats.firstScreenBytes)}`} tone={overBudget ? 'warn' : 'ok'} />
            <Row label="Items" value={String(stats.items)} tone={stats.items < COUNTS.hardMin ? 'warn' : 'ok'} />
            <Row label="Videos" value={String(stats.videos)} tone={stats.videos > VIDEOS.recommendedMax ? 'warn' : 'ok'} />
            <Row label="Stored" value={formatBytes(gallery.totalBytes)} />
          </dl>

          {overBudget && (
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-warn)]">
              Over the {formatBytes(PAGE_BUDGET.firstScreenBytes)} first-screen budget. On a 4G phone
              this will take noticeably longer than {PAGE_BUDGET.interactiveMs / 1000}s to feel
              interactive — dropping a video is the fastest fix.
            </p>
          )}
          {stats.missingAlt > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-warn)]">
              {stats.missingAlt} photo{stats.missingAlt === 1 ? '' : 's'} still need alt text.
            </p>
          )}
        </div>

        <div className="card p-4">
          <p className="label mb-3">
            {gallery.status === 'published' ? 'Live' : 'Not published'}
            {gallery.visibility !== 'public' ? ` · ${gallery.visibility}` : ''}
          </p>

          {gallery.status === 'published' ? (
            <>
              <div className="flex items-center gap-2">
                <input readOnly value={publicUrl} className="field py-1.5 font-mono text-xs" />
                <button
                  type="button"
                  className="btn whitespace-nowrap px-2.5 py-1.5 text-xs"
                  onClick={async () => {
                    await navigator.clipboard.writeText(publicUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              {qr && (
                <div className="mt-4 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt={`QR code for ${publicUrl}`} className="mx-auto" width={180} height={180} />
                  <p className="label mt-1">scan to open</p>
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className="btn flex-1"
                  onClick={() => void publish(true)}
                  disabled={busy}
                >
                  {busy ? 'Working…' : 'Update live site'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void publish(false)}
                  disabled={busy}
                >
                  Unpublish
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-[var(--color-dim)]">
                Publishing makes <code className="text-[var(--color-paper)]">/g/{gallery.slug}</code>{' '}
                reachable and locks the link — changing it afterwards breaks anything already shared.
              </p>
              <button
                type="button"
                className="btn btn-primary mt-3 w-full"
                onClick={() => void publish(true)}
                disabled={busy}
              >
                {busy ? 'Publishing…' : 'Publish'}
              </button>
            </>
          )}

          {message && <p className="mt-3 text-xs text-[var(--color-good)]">{message}</p>}
          {error && <p className="mt-3 text-xs text-[var(--color-bad)]">{error}</p>}
        </div>

        <div className="card p-4">
          <p className="label mb-2">Static export</p>
          <p className="text-xs leading-relaxed text-[var(--color-dim)]">
            A ZIP with one self-contained <code className="text-[var(--color-paper)]">index.html</code>{' '}
            and a <code className="text-[var(--color-paper)]">/media</code> folder — the same format
            you started from. Drop it on any static host, or keep it as an archive. No lock-in.
          </p>
          <button
            type="button"
            className="btn mt-3 w-full"
            onClick={() => void exportZip()}
            disabled={exporting || stats.items === 0}
          >
            {exporting ? 'Packaging…' : 'Download ZIP'}
          </button>
          {stats.items === 0 && (
            <p className="mt-2 text-xs text-[var(--color-dim)]">Nothing to export yet.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Row({
  label,
  value,
  tone = 'ok',
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--color-dim)]">{label}</dt>
      <dd style={tone === 'warn' ? { color: 'var(--color-warn)' } : undefined}>{value}</dd>
    </div>
  );
}

'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadOne } from '@/lib/compress/upload';
import { preflight } from '@/lib/compress/preflight';
import {
  ACCEPT_ATTRIBUTE,
  COUNTS,
  VIDEOS,
  QUOTAS,
  adviseCounts,
  assignSizeMix,
  formatBytes,
} from '@/lib/limits';
import type { MediaRow } from '@/lib/types';
import type { UploadPhase } from '@/lib/compress/types';
import ArrangeGrid from './arrange-grid';

interface UploadRow {
  key: string;
  name: string;
  sizeBytes: number;
  phase: UploadPhase;
  pct: number;
  note?: string;
  error?: string;
}

/** Uploads run 3 at a time (§5 step 2); compression itself is capped at 2 workers. */
const UPLOAD_CONCURRENCY = 3;

export default function MediaManager({
  galleryId,
  initialItems,
  galleryBytes,
  accountBytes,
}: {
  galleryId: string;
  initialItems: MediaRow[];
  galleryBytes: number;
  accountBytes: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState<MediaRow[]>(initialItems);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const total = items.length;
  const videos = items.filter((i) => i.kind === 'video').length;
  const photos = total - videos;
  const advice = useMemo(() => adviseCounts(total, videos), [total, videos]);

  const usedGallery = items.reduce((n, i) => n + Number(i.bytes), 0) || galleryBytes;
  const galleryFraction = usedGallery / QUOTAS.galleryBytes;

  const patch = useCallback((key: string, next: Partial<UploadRow>) => {
    setUploads((rows) => rows.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }, []);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (!files.length) return;

      setRejected([]);
      const accepted: File[] = [];
      const problems: string[] = [];

      // Pre-flight everything first, so the user sees all the rejections at
      // once rather than one at a time, thirty seconds apart.
      for (const file of files) {
        const check = await preflight(file);
        if (!check.ok) problems.push(...check.errors);
        else {
          accepted.push(file);
          problems.push(...check.warnings);
        }
      }
      setRejected(problems);
      if (!accepted.length) return;

      const rows: UploadRow[] = accepted.map((f) => ({
        key: `${f.name}-${f.size}-${crypto.randomUUID()}`,
        name: f.name,
        sizeBytes: f.size,
        phase: 'queued',
        pct: 0,
      }));
      setUploads((r) => [...r, ...rows]);

      // Simple bounded worker loop — three in flight, in order.
      let cursor = 0;
      const runNext = async (): Promise<void> => {
        const i = cursor++;
        if (i >= accepted.length) return;
        const file = accepted[i];
        const row = rows[i];

        try {
          const outcome = await uploadOne(file, galleryId, (u) =>
            patch(row.key, { phase: u.phase, pct: u.pct, note: u.note }),
          );
          patch(row.key, { phase: 'ready', pct: 100, note: outcome.savings });

          // Pull the committed row back so the arrange grid is accurate.
          const res = await fetch(`/api/media/${outcome.mediaId}`);
          if (res.ok) {
            const created = (await res.json()) as MediaRow;
            setItems((prev) => [...prev, created]);
          } else {
            router.refresh();
          }
        } catch (err) {
          patch(row.key, {
            phase: 'failed',
            pct: 100,
            error: err instanceof Error ? err.message : 'Upload failed.',
          });
        }
        return runNext();
      };

      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, accepted.length) }, runNext),
      );
      router.refresh();
    },
    [galleryId, patch, router],
  );

  const autoAssignSizes = useCallback(async () => {
    const sizes = assignSizeMix(items.length);
    const next = items.map((it, i) => ({ ...it, size: sizes[i] ?? it.size }));
    setItems(next);
    await Promise.all(
      next.map((it) =>
        fetch(`/api/media/${it.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ size: it.size }),
        }),
      ),
    );
    router.refresh();
  }, [items, router]);

  const shuffle = useCallback(async () => {
    const next = [...items];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    setItems(next);
    await fetch('/api/media/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ galleryId, order: next.map((i) => i.id) }),
    });
    router.refresh();
  }, [items, galleryId, router]);

  const activeUploads = uploads.filter((u) => u.phase !== 'ready' && u.phase !== 'failed');

  return (
    <div className="mt-8 space-y-8">
      {/* ── counters ──────────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Counter
          label="Photos"
          value={photos}
          hint={`of ~${COUNTS.sweetSpotHigh - VIDEOS.recommendedMax} recommended`}
        />
        <Counter
          label="Videos"
          value={videos}
          hint={`${VIDEOS.recommendedMin}–${VIDEOS.recommendedMax} recommended · ${VIDEOS.hardMax} max`}
          tone={videos > VIDEOS.hardMax ? 'bad' : videos > VIDEOS.recommendedMax ? 'warn' : 'ok'}
        />
        <Counter
          label="Total"
          value={total}
          hint={`aim for ${COUNTS.sweetSpotLow}–${COUNTS.sweetSpotHigh}`}
          tone={
            total > COUNTS.hardMax
              ? 'bad'
              : total > COUNTS.softMax || (total > 0 && total < COUNTS.recommendedMin)
                ? 'warn'
                : 'ok'
          }
        />
      </section>

      {advice.map((a, i) => (
        <Banner key={i} level={a.level}>
          {a.message}
        </Banner>
      ))}

      {galleryFraction > 0.8 && (
        <Banner level={galleryFraction >= 1 ? 'error' : 'warn'}>
          {formatBytes(usedGallery)} of this gallery&apos;s {formatBytes(QUOTAS.galleryBytes)} budget
          used. Videos are almost always where the space went — removing one usually frees more than
          twenty photos would.
        </Banner>
      )}

      {/* ── dropzone ──────────────────────────────────────────────────────── */}
      <section>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className="card flex cursor-pointer flex-col items-center justify-center px-6 py-14 text-center transition-colors"
          style={{
            borderStyle: 'dashed',
            borderColor: dragOver ? 'var(--color-accent)' : 'var(--color-line)',
            background: dragOver ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : undefined,
          }}
        >
          <p className="text-sm font-medium">Drop photos and videos here</p>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-[var(--color-dim)]">
            JPEG, PNG, WebP, AVIF, HEIC · MP4, MOV, WebM. Photos up to 50 MB, video up to 500 MB and
            90 seconds. Everything is re-encoded here in the browser first — a 14 MB photo typically
            uploads as about 300 KB.
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {rejected.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {rejected.map((r, i) => (
              <li key={i} className="text-xs text-[var(--color-warn)]">
                {r}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── progress ──────────────────────────────────────────────────────── */}
      {uploads.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="label">
              {activeUploads.length > 0 ? `Processing ${activeUploads.length}` : 'Recent uploads'}
            </h2>
            {activeUploads.length === 0 && (
              <button
                type="button"
                className="btn px-2.5 py-1 text-xs"
                onClick={() => setUploads([])}
              >
                Clear
              </button>
            )}
          </div>
          <ul className="space-y-1.5">
            {uploads.map((u) => (
              <UploadRowView key={u.key} row={u} />
            ))}
          </ul>
        </section>
      )}

      {/* ── arrange ───────────────────────────────────────────────────────── */}
      <section id="arrange">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Arrange</h2>
            <p className="mt-0.5 text-xs text-[var(--color-dim)]">
              Size, caption, alt text, crop focus and order. Drag a tile to move it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn px-2.5 py-1 text-xs"
              onClick={autoAssignSizes}
              disabled={!items.length}
              title="25% small · 40% medium · 25% large · 10% extra-large"
            >
              Auto-assign sizes
            </button>
            <button
              type="button"
              className="btn px-2.5 py-1 text-xs"
              onClick={shuffle}
              disabled={items.length < 2}
            >
              Shuffle order
            </button>
          </div>
        </div>

        <ArrangeGrid
          galleryId={galleryId}
          items={items}
          onChange={setItems}
          accountBytes={accountBytes}
        />
      </section>
    </div>
  );
}

function Counter({
  label,
  value,
  hint,
  tone = 'ok',
}: {
  label: string;
  value: number;
  hint: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'bad' ? 'var(--color-bad)' : tone === 'warn' ? 'var(--color-warn)' : undefined;
  return (
    <div className="card px-4 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 text-2xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-[var(--color-dim)]">{hint}</p>
    </div>
  );
}

function Banner({ level, children }: { level: 'ok' | 'warn' | 'error'; children: React.ReactNode }) {
  const color =
    level === 'error' ? 'var(--color-bad)' : level === 'warn' ? 'var(--color-warn)' : 'var(--color-good)';
  const icon = level === 'ok' ? '✓' : '!';
  return (
    <div
      className="flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm"
      style={{
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <span style={{ color }} aria-hidden>
        {icon}
      </span>
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}

function UploadRowView({ row }: { row: UploadRow }) {
  const label: Record<UploadPhase, string> = {
    queued: 'queued',
    validating: 'checking',
    compressing: 'compressing',
    uploading: 'uploading',
    ready: 'ready',
    failed: 'failed',
  };

  const color =
    row.phase === 'failed'
      ? 'var(--color-bad)'
      : row.phase === 'ready'
        ? 'var(--color-good)'
        : 'var(--color-accent)';

  return (
    <li className="card px-3.5 py-2.5">
      <div className="flex items-center gap-3 text-sm">
        <span className="min-w-0 flex-1 truncate">{row.name}</span>
        <span className="label whitespace-nowrap" style={{ color }}>
          {label[row.phase]}
          {row.phase !== 'ready' && row.phase !== 'failed' ? ` ${row.pct}%` : ''}
        </span>
      </div>

      {row.phase !== 'failed' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-line)]">
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${row.pct}%`, background: color }}
          />
        </div>
      )}

      {(row.note || row.error) && (
        <p
          className="mt-1.5 text-xs leading-relaxed"
          style={{ color: row.error ? 'var(--color-bad)' : 'var(--color-dim)' }}
        >
          {row.error ?? row.note}
        </p>
      )}
    </li>
  );
}

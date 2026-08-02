'use client';

import { useCallback, useState } from 'react';
import { SIZE_KEYS, SIZE_MULTIPLIERS, formatBytes, formatSavings, type SizeKey } from '@/lib/limits';
import type { MediaRow } from '@/lib/types';
import FocalPicker from './focal-picker';

/**
 * Step 3 (§5): per-item size, caption, alt text, focal point, order, delete.
 * Every edit PATCHes immediately — there's no separate save, because losing a
 * caption to a forgotten save button is worse than an extra request.
 */
export default function ArrangeGrid({
  galleryId,
  items,
  onChange,
  accountBytes,
}: {
  galleryId: string;
  items: MediaRow[];
  onChange: (next: MediaRow[]) => void;
  accountBytes: number;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [focalFor, setFocalFor] = useState<MediaRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patchItem = useCallback(
    async (id: string, patch: Partial<MediaRow>, body: Record<string, unknown>) => {
      onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
      const res = await fetch(`/api/media/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? 'That change didn’t save.');
      }
    },
    [items, onChange],
  );

  const remove = useCallback(
    async (item: MediaRow) => {
      setBusy(item.id);
      setError(null);
      const res = await fetch(`/api/media/${item.id}`, { method: 'DELETE' });
      setBusy(null);
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? 'Could not delete that item.');
        return;
      }
      onChange(items.filter((i) => i.id !== item.id));
    },
    [items, onChange],
  );

  const commitOrder = useCallback(
    async (next: MediaRow[]) => {
      onChange(next);
      await fetch('/api/media/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ galleryId, order: next.map((i) => i.id) }),
      });
    },
    [galleryId, onChange],
  );

  const onDrop = useCallback(
    (targetId: string) => {
      if (!dragId || dragId === targetId) return;
      const from = items.findIndex((i) => i.id === dragId);
      const to = items.findIndex((i) => i.id === targetId);
      if (from < 0 || to < 0) return;
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setDragId(null);
      void commitOrder(next);
    },
    [dragId, items, commitOrder],
  );

  if (!items.length) {
    return (
      <p className="card px-4 py-8 text-center text-sm text-[var(--color-dim)]">
        Nothing uploaded yet. The wall will show the striped placeholder tiles until you add media.
      </p>
    );
  }

  return (
    <>
      {error && <p className="mb-3 text-sm text-[var(--color-bad)]">{error}</p>}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => (
          <li
            key={item.id}
            draggable
            onDragStart={() => setDragId(item.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(item.id)}
            className="card overflow-hidden"
            style={{ opacity: busy === item.id ? 0.4 : 1, cursor: 'grab' }}
          >
            {/* thumbnail */}
            <div className="relative aspect-[4/3] bg-[var(--color-panel-2)]">
              {item.grid_url || item.poster_url ? (
                // Raw <img>: these are R2 URLs at grid resolution already, and
                // next/image would only re-fetch them through the optimizer.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(item.kind === 'video' ? item.poster_url : item.grid_url) ?? ''}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{ objectPosition: `${item.focal_x}% ${item.focal_y}%` }}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="label">{item.status}</span>
                </div>
              )}

              <span className="label absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5">
                {String(index + 1).padStart(2, '0')}
              </span>
              {item.kind === 'video' && (
                <span className="label absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5">
                  {item.duration_s ? `${Math.round(Number(item.duration_s))}s` : 'video'}
                </span>
              )}
            </div>

            <div className="space-y-3 p-3">
              {/* size */}
              <div>
                <p className="label mb-1.5">Size on the wall</p>
                <div className="flex gap-1.5">
                  {SIZE_KEYS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void patchItem(item.id, { size: s }, { size: s })}
                      className="flex-1 rounded border px-1 py-1.5 text-xs transition-colors"
                      style={{
                        borderColor:
                          item.size === s ? 'var(--color-accent)' : 'var(--color-line)',
                        background:
                          item.size === s
                            ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                            : 'transparent',
                      }}
                      title={`${(SIZE_MULTIPLIERS[s as SizeKey] * 100).toFixed(0)}% of the base tile unit`}
                    >
                      <span
                        className="mx-auto mb-1 block rounded-sm bg-[var(--color-dim)]"
                        style={{
                          width: `${SIZE_MULTIPLIERS[s as SizeKey] * 14}px`,
                          height: `${SIZE_MULTIPLIERS[s as SizeKey] * 14}px`,
                        }}
                      />
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* tag */}
              <div>
                <label className="label mb-1 block">Caption (on hover)</label>
                <input
                  className="field py-1.5 text-xs"
                  defaultValue={item.tag ?? ''}
                  placeholder="Jaipur, 2025"
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== item.tag) void patchItem(item.id, { tag: v }, { tag: v });
                  }}
                />
              </div>

              {/* alt */}
              {item.kind === 'image' && (
                <div>
                  <label className="label mb-1 block">
                    Alt text{' '}
                    <span style={{ color: item.alt?.trim() ? undefined : 'var(--color-warn)' }}>
                      · required
                    </span>
                  </label>
                  <input
                    className="field py-1.5 text-xs"
                    defaultValue={item.alt ?? ''}
                    placeholder="What's in the photo"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== item.alt) void patchItem(item.id, { alt: v }, { alt: v });
                    }}
                  />
                </div>
              )}

              {/* meta + actions */}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span
                  className="text-xs text-[var(--color-dim)]"
                  title={
                    item.source_bytes
                      ? formatSavings(Number(item.source_bytes), Number(item.bytes))
                      : undefined
                  }
                >
                  {formatBytes(Number(item.bytes))}
                  {item.source_bytes > 0 && (
                    <>
                      {' · '}
                      {Math.max(
                        0,
                        Math.round((1 - Number(item.bytes) / Number(item.source_bytes)) * 100),
                      )}
                      % smaller
                    </>
                  )}
                </span>

                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className="btn px-2 py-1 text-xs"
                    onClick={() => setFocalFor(item)}
                  >
                    Crop
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger px-2 py-1 text-xs"
                    onClick={() => void remove(item)}
                    disabled={busy === item.id}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-[var(--color-dim)]">
        {items.length} items · {formatBytes(items.reduce((n, i) => n + Number(i.bytes), 0))} in this
        gallery · {formatBytes(accountBytes)} across the account
      </p>

      {focalFor && (
        <FocalPicker
          item={focalFor}
          onClose={() => setFocalFor(null)}
          onSave={(x, y) => {
            void patchItem(focalFor.id, { focal_x: x, focal_y: y }, { focalX: x, focalY: y });
            setFocalFor(null);
          }}
        />
      )}
    </>
  );
}

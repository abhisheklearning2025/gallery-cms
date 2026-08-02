'use client';

import { useRef, useState } from 'react';
import { ASPECTS } from '@/lib/limits';
import type { MediaRow } from '@/lib/types';

const ASPECT_LABELS = ['3:4', '1:1', '4:3', '16:10', '4:5', '5:4'];

/**
 * Focal point + live crop preview (§2.5).
 *
 * The engine assigns one of six aspect ratios by tile index and covers the
 * tile, so the same photo can be cropped six different ways depending on where
 * it lands — and it lands somewhere different on every viewport. Rather than
 * pretend that's controllable, this shows all six at once and lets you pick the
 * point that must stay in frame.
 */
export default function FocalPicker({
  item,
  onClose,
  onSave,
}: {
  item: MediaRow;
  onClose: () => void;
  onSave: (x: number, y: number) => void;
}) {
  const [x, setX] = useState(Number(item.focal_x));
  const [y, setY] = useState(Number(item.focal_y));
  const stageRef = useRef<HTMLDivElement>(null);

  const src = (item.kind === 'video' ? item.poster_url : item.grid_url) ?? '';

  const setFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setX(Math.round(((e.clientX - rect.left) / rect.width) * 100));
    setY(Math.round(((e.clientY - rect.top) / rect.height) * 100));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Set focal point"
    >
      <div
        className="card max-h-[90dvh] w-full max-w-3xl overflow-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Focal point</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-dim)]">
              Click the spot that must never be cropped out. The wall picks one of these six shapes
              per tile, and the same photo appears at different shapes in different places.
            </p>
          </div>
          <button type="button" className="btn px-2.5 py-1 text-xs" onClick={onClose}>
            Close
          </button>
        </div>

        <div
          ref={stageRef}
          onClick={setFromEvent}
          className="relative mx-auto max-h-[45dvh] cursor-crosshair overflow-hidden rounded-md border border-[var(--color-line)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="block max-h-[45dvh] w-full object-contain" />
          <span
            className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,.6)]"
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        </div>

        <p className="label mt-3 text-center">
          focus {x}% / {y}%
        </p>

        <div className="mt-5">
          <p className="label mb-2">How it will crop</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {ASPECTS.map((a, i) => (
              <figure key={i}>
                <div
                  className="overflow-hidden rounded border border-[var(--color-line)] bg-[var(--color-panel-2)]"
                  style={{ aspectRatio: String(a) }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className="h-full w-full object-cover"
                    style={{ objectPosition: `${x}% ${y}%` }}
                  />
                </div>
                <figcaption className="label mt-1 text-center">{ASPECT_LABELS[i]}</figcaption>
              </figure>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setX(50);
              setY(50);
            }}
          >
            Centre
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(x, y)}>
            Save focal point
          </button>
        </div>
      </div>
    </div>
  );
}

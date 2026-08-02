'use client';

import { useActionState, useState } from 'react';
import { updateGallery, type ActionState } from '../../actions';
import SlugField from '@/components/admin/slug-field';
import type { GalleryRow } from '@/lib/types';

export default function DetailsForm({
  gallery,
  siteOrigin,
}: {
  gallery: GalleryRow;
  siteOrigin: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateGallery, {});
  const [title, setTitle] = useState(gallery.title);
  const [accent, setAccent] = useState(gallery.accent);
  const [bg, setBg] = useState(gallery.bg);
  const [visibility, setVisibility] = useState(gallery.visibility);
  const [drift, setDrift] = useState(Number(gallery.drift_speed));
  const [density, setDensity] = useState(Number(gallery.density));

  // Slug is immutable-by-default once live (§7) — unlocked only by an explicit
  // confirm, because changing it breaks every link already shared.
  const [slugUnlocked, setSlugUnlocked] = useState(gallery.status !== 'published');
  const [askedAboutSlug, setAskedAboutSlug] = useState(false);

  return (
    <form action={action} className="mt-8 space-y-6">
      <input type="hidden" name="id" value={gallery.id} />
      <input type="hidden" name="confirm_slug_change" value={String(slugUnlocked)} />

      <div>
        <label className="label mb-1.5 block" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          name="title"
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="label mb-1.5 block" htmlFor="tagline">
          Tagline
        </label>
        <input id="tagline" name="tagline" className="field" defaultValue={gallery.tagline} />
      </div>

      <div>
        <SlugField
          title={title}
          initial={gallery.slug}
          exceptId={gallery.id}
          siteOrigin={siteOrigin}
          locked={!slugUnlocked}
          onLockedEdit={() => setAskedAboutSlug(true)}
        />
        {!slugUnlocked && (
          <div className="mt-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
            <p className="text-xs leading-relaxed text-[var(--color-dim)]">
              This gallery is live at <code className="text-[var(--color-paper)]">/g/{gallery.slug}</code>.
              Changing the link breaks every URL and QR code already shared — the old address will 404.
            </p>
            <button
              type="button"
              className="btn btn-danger mt-2.5 px-2.5 py-1 text-xs"
              onClick={() => setSlugUnlocked(true)}
              style={askedAboutSlug ? { borderColor: 'var(--color-bad)' } : undefined}
            >
              Change link anyway
            </button>
          </div>
        )}
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <ColorField label="Accent" name="accent" value={accent} onChange={setAccent} />
        <ColorField label="Background" name="bg" value={bg} onChange={setBg} />
      </fieldset>

      <div>
        <label className="label mb-1.5 block" htmlFor="visibility">
          Visibility
        </label>
        <select
          id="visibility"
          name="visibility"
          className="field"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as GalleryRow['visibility'])}
        >
          <option value="public">Public — anyone with the link, indexed</option>
          <option value="unlisted">Unlisted — anyone with the link, not indexed</option>
          <option value="password">Password protected</option>
        </select>

        {visibility === 'password' && (
          <div className="mt-3">
            <label className="label mb-1.5 block" htmlFor="password">
              {gallery.password_hash ? 'New password (leave blank to keep the current one)' : 'Password'}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="field"
              autoComplete="new-password"
              placeholder={gallery.password_hash ? '••••••••' : 'Set a password'}
            />
            <p className="mt-1.5 text-xs text-[var(--color-dim)]">
              Changing the password signs out everyone who had already unlocked the gallery.
            </p>
          </div>
        )}
      </div>

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-medium">Motion &amp; density</summary>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-dim)]">
          These multiply the engine&apos;s own constants. 1.0 is the reference feel — the same drift
          and tile scale as the original file. Anyone with reduced-motion enabled gets no drift
          regardless.
        </p>

        <div className="mt-4 space-y-4">
          <Slider
            label="Drift speed"
            name="drift_speed"
            value={drift}
            onChange={setDrift}
            min={0}
            max={3}
            step={0.1}
            note={drift === 0 ? 'Stationary until dragged.' : `${drift.toFixed(1)}× the reference drift.`}
          />
          <Slider
            label="Tile density"
            name="density"
            value={density}
            onChange={setDensity}
            min={0.5}
            max={2}
            step={0.05}
            note={
              density > 1
                ? `${density.toFixed(2)}× — larger tiles, fewer on screen.`
                : density < 1
                  ? `${density.toFixed(2)}× — smaller tiles, denser wall.`
                  : 'Reference size.'
            }
          />
        </div>
      </details>

      <label className="flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          name="show_filters"
          defaultChecked={gallery.show_filters}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        Show the All / Photos / Video filters
      </label>

      {state.error && <p className="text-sm text-[var(--color-bad)]">{state.error}</p>}
      {state.ok && <p className="text-sm text-[var(--color-good)]">Saved.</p>}

      <div className="flex gap-3 pt-1">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </form>
  );
}

function ColorField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label mb-1.5 block" htmlFor={name}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          id={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-[var(--color-line)] bg-transparent"
          aria-label={`${label} colour`}
        />
        <input
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="field font-mono text-sm"
          pattern="#[0-9a-fA-F]{6}"
        />
      </div>
    </div>
  );
}

function Slider({
  label,
  name,
  value,
  onChange,
  min,
  max,
  step,
  note,
}: {
  label: string;
  name: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  note: string;
}) {
  return (
    <div>
      <label className="label mb-1.5 block" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
      <p className="mt-1 text-xs text-[var(--color-dim)]">{note}</p>
    </div>
  );
}

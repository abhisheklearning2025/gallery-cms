'use client';

import { useActionState, useState } from 'react';
import { createGallery, type ActionState } from '../../actions';
import SlugField from '@/components/admin/slug-field';

export default function NewGalleryForm({ siteOrigin }: { siteOrigin: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createGallery, {});
  const [title, setTitle] = useState('');
  const [accent, setAccent] = useState('#5A6CFF');
  const [bg, setBg] = useState('#0E0E11');

  return (
    <form action={action} className="mt-8 space-y-5">
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
          placeholder="Abhishek &amp; Krati"
          required
          autoFocus
        />
      </div>

      <div>
        <label className="label mb-1.5 block" htmlFor="tagline">
          Tagline
        </label>
        <input
          id="tagline"
          name="tagline"
          className="field"
          defaultValue="drag to explore"
          placeholder="12 · 11 · 2025 · Jaipur"
        />
        <p className="mt-1.5 text-xs text-[var(--color-dim)]">
          The small line under the title. A date and place reads well here.
        </p>
      </div>

      <SlugField title={title} siteOrigin={siteOrigin} />

      <div className="grid gap-4 sm:grid-cols-2">
        <ColorField
          label="Accent"
          name="accent"
          value={accent}
          onChange={setAccent}
          hint="Hover outline, the pulsing dot, filter underline."
        />
        <ColorField
          label="Background"
          name="bg"
          value={bg}
          onChange={setBg}
          hint="The void behind the tiles. Dark works best."
        />
      </div>

      <div>
        <label className="label mb-1.5 block" htmlFor="visibility">
          Visibility
        </label>
        <select id="visibility" name="visibility" className="field" defaultValue="public">
          <option value="public">Public — anyone with the link, indexed</option>
          <option value="unlisted">Unlisted — anyone with the link, not indexed</option>
          <option value="password">Password — set the password in the editor</option>
        </select>
      </div>

      {state.error && <p className="text-sm text-[var(--color-bad)]">{state.error}</p>}

      <div className="flex gap-3 pt-2">
        <button type="submit" className="btn btn-primary" disabled={pending || !title.trim()}>
          {pending ? 'Creating…' : 'Create and add media'}
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
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
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
      <p className="mt-1.5 text-xs text-[var(--color-dim)]">{hint}</p>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { slugify, validateSlug, slugProblemMessage } from '@/lib/slug';

interface CheckResult {
  available: boolean;
  reason: string | null;
  suggestion: string | null;
}

/**
 * Slug field with live availability (§5 step 1). Auto-slugifies from the title
 * until the user edits it by hand, then leaves it alone.
 */
export default function SlugField({
  name = 'slug',
  title,
  initial,
  exceptId,
  siteOrigin,
  locked,
  onLockedEdit,
}: {
  name?: string;
  title: string;
  initial?: string;
  exceptId?: string;
  siteOrigin: string;
  locked?: boolean;
  onLockedEdit?: () => void;
}) {
  const [slug, setSlug] = useState(initial ?? '');
  const [touched, setTouched] = useState(Boolean(initial));
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  // Follow the title until the field is edited directly.
  useEffect(() => {
    if (touched) return;
    setSlug(slugify(title));
  }, [title, touched]);

  useEffect(() => {
    if (!slug) {
      setCheck(null);
      return;
    }
    const problem = validateSlug(slug);
    if (problem) {
      setCheck({ available: false, reason: slugProblemMessage(problem), suggestion: slugify(slug) });
      return;
    }
    if (slug === initial) {
      setCheck({ available: true, reason: null, suggestion: null });
      return;
    }

    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ slug });
        if (exceptId) params.set('exceptId', exceptId);
        const res = await fetch(`/api/slug/check?${params}`);
        const body = (await res.json()) as CheckResult;
        if (!cancelled) setCheck(body);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [slug, exceptId, initial]);

  const state = checking ? 'checking' : check?.available ? 'ok' : check ? 'bad' : 'idle';

  return (
    <div>
      <label className="label mb-1.5 block" htmlFor={name}>
        Public link
      </label>

      <div className="flex items-stretch overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]">
        <span className="flex select-none items-center whitespace-nowrap border-r border-[var(--color-line)] px-3 text-sm text-[var(--color-dim)]">
          {siteOrigin.replace(/^https?:\/\//, '')}/g/
        </span>
        <input
          id={name}
          name={name}
          value={slug}
          readOnly={locked}
          onChange={(e) => {
            if (locked) {
              onLockedEdit?.();
              return;
            }
            setTouched(true);
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
          }}
          onFocus={() => locked && onLockedEdit?.()}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
          placeholder="abhishek-krati"
          aria-describedby={`${name}-status`}
        />
      </div>

      <p
        id={`${name}-status`}
        className="mt-1.5 text-xs"
        style={{
          color:
            state === 'ok'
              ? 'var(--color-good)'
              : state === 'bad'
                ? 'var(--color-bad)'
                : 'var(--color-dim)',
        }}
      >
        {state === 'checking' && 'Checking…'}
        {state === 'ok' && `${siteOrigin}/g/${slug} is available.`}
        {state === 'bad' && (
          <>
            {check?.reason}
            {check?.suggestion && (
              <>
                {' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setTouched(true);
                    setSlug(check.suggestion as string);
                  }}
                >
                  Use “{check.suggestion}”
                </button>
              </>
            )}
          </>
        )}
        {state === 'idle' && 'Lowercase letters, numbers and hyphens.'}
      </p>
    </div>
  );
}

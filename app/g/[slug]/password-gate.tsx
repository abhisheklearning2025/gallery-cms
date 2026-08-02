'use client';

import { useState } from 'react';

export default function PasswordGate({
  slug,
  title,
  accent,
  bg,
}: {
  slug: string;
  title: string;
  accent: string;
  bg: string;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/g/${encodeURIComponent(slug)}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.reload();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setError(body.error ?? 'That password didn’t work.');
    setBusy(false);
  }

  return (
    <main
      className="flex min-h-dvh items-center justify-center px-6"
      style={{ background: bg, color: '#ECEAE4' }}
    >
      <form onSubmit={submit} className="w-full max-w-sm">
        <p className="label mb-3">Private gallery</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-[var(--color-dim)]">Enter the password to view.</p>

        <input
          type="password"
          className="field mt-6"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
        />

        {error && <p className="mt-3 text-sm text-[var(--color-bad)]">{error}</p>}

        <button
          type="submit"
          className="btn mt-4 w-full"
          style={{ background: accent, borderColor: accent, color: '#fff' }}
          disabled={busy || password.length === 0}
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </main>
  );
}

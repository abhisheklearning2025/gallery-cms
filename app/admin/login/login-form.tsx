'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn, type ActionState } from '../actions';

export default function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/admin';
  const [state, action, pending] = useActionState<ActionState, FormData>(signIn, {});

  return (
    <form action={action} className="mt-8 space-y-3">
      <input type="hidden" name="next" value={next} />

      <div>
        <label className="label mb-1.5 block" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" className="field" autoComplete="username" required />
      </div>

      <div>
        <label className="label mb-1.5 block" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="field"
          autoComplete="current-password"
          required
        />
      </div>

      {state.error && <p className="text-sm text-[var(--color-bad)]">{state.error}</p>}

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

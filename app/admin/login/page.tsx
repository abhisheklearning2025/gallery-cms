import { Suspense } from 'react';
import LoginForm from './login-form';
import { isConfigured } from '@/lib/env';

export default function LoginPage() {
  if (!isConfigured.supabase) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <p className="label mb-3">Not configured</p>
        <h1 className="text-xl font-semibold">Connect Supabase first.</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-dim)]">
          Fill in the Supabase keys in <code>.env.local</code>, then run{' '}
          <code>pnpm migrate &amp;&amp; pnpm seed</code>. Step-by-step instructions are in
          SETUP-TASKS.md.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="label mb-3">Infinite Gallery</p>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-[var(--color-dim)]">
        There is no public signup — the single admin account is created by <code>pnpm seed</code>.
      </p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

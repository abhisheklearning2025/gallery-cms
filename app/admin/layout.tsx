import { Suspense } from 'react';
import Link from 'next/link';
import { getSessionUser } from '@/lib/supabase/server';
import { getAccountUsage } from '@/lib/quota';
import { isConfigured } from '@/lib/env';
import { signOut } from './actions';
import StorageMeter from '@/components/admin/storage-meter';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <Suspense fallback={<HeaderShell />}>
        <Header />
      </Suspense>
      <Suspense fallback={<div className="mx-auto max-w-6xl px-6 py-10 text-sm text-[var(--color-dim)]">Loading…</div>}>
        {children}
      </Suspense>
    </div>
  );
}

function HeaderShell({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-ink)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3.5">
        <Link href="/admin" className="text-sm font-bold tracking-tight">
          Infinite Gallery
        </Link>
        <span className="label hidden sm:inline">admin</span>
        <div className="flex-1" />
        {children}
      </div>
    </header>
  );
}

async function Header() {
  const user = await getSessionUser().catch(() => null);
  if (!user) return <HeaderShell />;

  const used = isConfigured.storage ? await getAccountUsage(user.id).catch(() => 0) : 0;

  return (
    <HeaderShell>
      <StorageMeter used={used} />
      <span className="label hidden md:inline">{user.email}</span>
      <form action={signOut}>
        <button type="submit" className="btn px-3 py-1.5 text-xs">
          Sign out
        </button>
      </form>
    </HeaderShell>
  );
}

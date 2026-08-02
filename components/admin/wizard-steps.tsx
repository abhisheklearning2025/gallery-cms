import Link from 'next/link';
import type { Route } from 'next';

const STEPS = [
  { n: 1, label: 'Details', path: '' },
  { n: 2, label: 'Upload', path: '/media' },
  { n: 3, label: 'Arrange', path: '/media#arrange' },
  { n: 4, label: 'Preview & publish', path: '/preview' },
] as const;

export default function WizardSteps({ id, current }: { id: string; current: 1 | 2 | 3 | 4 }) {
  return (
    <nav className="mb-8 flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
      {STEPS.map((s, i) => {
        const active = s.n === current;
        return (
          <span key={s.n} className="flex items-center gap-1">
            <Link
              href={`/admin/g/${id}${s.path}` as Route}
              className="rounded px-2.5 py-1 transition-colors"
              style={{
                background: active ? 'var(--color-panel-2)' : 'transparent',
                color: active ? 'var(--color-paper)' : 'var(--color-dim)',
              }}
            >
              <span className="label mr-1.5">{s.n}</span>
              {s.label}
            </Link>
            {i < STEPS.length - 1 && <span className="text-[var(--color-line)]">→</span>}
          </span>
        );
      })}
    </nav>
  );
}

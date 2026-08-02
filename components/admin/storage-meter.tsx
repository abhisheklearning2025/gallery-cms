import { QUOTAS, formatBytes } from '@/lib/limits';

/**
 * `1.4 GB / 8 GB used` in the admin header (§2.7). Turns amber at 80% and red
 * at the 95% block threshold, where uploads stop being signed.
 */
export default function StorageMeter({ used }: { used: number }) {
  const fraction = Math.min(1, used / QUOTAS.accountBytes);
  const pct = Math.round(fraction * 100);
  const blocked = fraction >= QUOTAS.blockAtFraction;
  const warn = fraction >= 0.8;

  const color = blocked ? 'var(--color-bad)' : warn ? 'var(--color-warn)' : 'var(--color-accent)';

  return (
    <div className="hidden items-center gap-2.5 sm:flex" title={`${pct}% of your storage quota`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-line)]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.max(2, pct)}%`, background: color }}
        />
      </div>
      <span className="label" style={blocked || warn ? { color } : undefined}>
        {formatBytes(used)} / {formatBytes(QUOTAS.accountBytes)}
      </span>
    </div>
  );
}

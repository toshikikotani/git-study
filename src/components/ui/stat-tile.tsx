/**
 * ホームに並ぶ数字1個分の枠(FR-61)。
 * 数字が主役。ラベルと補足は小さく、視線が数字に落ちるようにする。
 */
export function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
  badge,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'positive' | 'warn';
  badge?: string;
}) {
  const toneClass = {
    neutral: 'text-neutral-900 dark:text-neutral-50',
    positive: 'text-emerald-700 dark:text-emerald-400',
    warn: 'text-amber-700 dark:text-amber-400',
  }[tone];

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2">
        <span className="text-sm text-neutral-500 dark:text-neutral-400">{label}</span>
        {badge ? (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {badge}
          </span>
        ) : null}
      </div>
      <p className={`mt-1 text-3xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      {sub ? <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{sub}</p> : null}
    </div>
  );
}

/** 完済の進捗ゲージ(FR-63)。 */
export function ProgressGauge({ ratio, label }: { ratio: number; label: string }) {
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  return (
    <div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {label} {percent}%
      </p>
    </div>
  );
}

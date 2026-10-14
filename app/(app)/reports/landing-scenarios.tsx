'use client';

import { formatYen } from '@/domain/money';

/**
 * 月末着地のシナリオを横バーで表示する。
 * p10（楽観）/ p50（中央）/ p90（悲観）の範囲を一目で比較。
 */
export function LandingScenarios({
  p10,
  p50,
  p90,
  budgetYen,
}: {
  p10: number;
  p50: number;
  p90: number;
  budgetYen: number | null;
}) {
  if (p50 <= 0) return null;

  const max = Math.max(p90, budgetYen ?? 0, p50) * 1.1;
  const scenarios = [
    { label: '楽観', value: p10, color: 'var(--state-ok)', note: '10%' },
    { label: '中央', value: p50, color: 'var(--accent)', note: '50%' },
    { label: '悲観', value: p90, color: 'var(--state-warn)', note: '90%' },
  ];

  return (
    <section
      className="glass space-y-3 rounded-2xl p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
        月末着地のシナリオ
      </h2>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        今のペースが続いた場合の月末支出の幅です。
        楽観（下位10%）、中央、悲観（上位10%）を比較しています。
      </p>

      <div className="space-y-2">
        {scenarios.map((s) => {
          const pct = Math.min(100, (s.value / max) * 100);
          const over = budgetYen !== null && s.value > budgetYen;
          return (
            <div key={s.label} className="flex items-center gap-2">
              <div
                className="w-10 shrink-0 text-right text-xs tabular"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {s.label}
              </div>
              <div
                className="relative h-7 flex-1 overflow-hidden rounded-full"
                style={{ background: 'var(--plane)' }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    background: s.color,
                    opacity: 0.85,
                  }}
                />
                {budgetYen !== null ? (
                  <div
                    className="absolute top-0 h-full w-0.5"
                    style={{
                      left: `${Math.min(100, (budgetYen / max) * 100)}%`,
                      background: 'var(--ink)',
                      opacity: 0.4,
                    }}
                  />
                ) : null}
              </div>
              <div
                className="w-[72px] shrink-0 text-right text-xs tabular"
                style={{ color: over ? 'var(--state-warn)' : 'var(--ink)' }}
              >
                {formatYen(s.value, { sign: 'never' })}
              </div>
            </div>
          );
        })}
      </div>

      {budgetYen !== null ? (
        <p className="text-xs tabular" style={{ color: 'var(--ink-secondary)' }}>
          予算:{' '}
          <strong style={{ color: 'var(--ink)' }}>{formatYen(budgetYen, { sign: 'never' })}</strong>{' '}
          <span style={{ opacity: 0.6 }}>（縦線）</span>
        </p>
      ) : null}
    </section>
  );
}

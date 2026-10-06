import { formatEstimate } from '@/domain/forecast/format';
import type { Forecast } from '@/domain/forecast/types';
import { formatYen } from '@/domain/money';
import { paceReason } from '@/domain/report-insights';

type Step = { key: string; label: string; yen: number; fact: boolean };

/**
 * なぜこの見込み?(設計書 v3 3.5)。月末の見込みを積み上げで見せる:
 * 使った額 → 決まっている額 → 規則的な来店 → 請求 → 未記録 → 特別費 → 残りの変動費 → 月末。
 * 中央値どうしは足し算にならないので、残り全体は中央値、その内訳は平均の比で配っている
 * (forecast.breakdown)。合計は見出しの中央と必ず一致する。
 */
export function WhyCard({ forecast, endLabel }: { forecast: Forecast; endLabel: string }) {
  const b = forecast.breakdown;
  if (b.totalYen <= 0) return null;
  const steps: Step[] = [
    { key: 'actual', label: '使った額', yen: b.actualYen, fact: true },
    { key: 'committed', label: '決まっている額(予定・固定費)', yen: b.committedYen, fact: true },
    { key: 'visits', label: '規則的な来店', yen: b.visitsYen, fact: false },
    { key: 'bills', label: '毎月の請求', yen: b.billsYen, fact: false },
    { key: 'unrecorded', label: 'まだ記録していない分', yen: b.unrecordedYen, fact: false },
    { key: 'special', label: '特別費', yen: b.specialYen, fact: false },
    { key: 'variable', label: '残りの変動費', yen: b.variableYen, fact: false },
  ].filter((s) => s.key === 'actual' || s.yen > 0);
  const pct = (yen: number) => `${Math.max(0, Math.min(100, (yen / b.totalYen) * 100))}%`;
  let cum = 0;
  const topVariable = b.variableByCategory.slice(0, 3).filter((c) => c.yen > 0);
  const reason = paceReason(forecast)?.text ?? null;
  return (
    <section
      aria-label="なぜこの見込み?"
      className="rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        なぜこの見込み?
      </p>
      {reason ? (
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
          {reason}
        </p>
      ) : null}
      <ol className="mt-3 space-y-2">
        {steps.map((step) => {
          const start = cum;
          cum += step.yen;
          const amount = step.fact
            ? formatYen(step.yen, { sign: 'never' })
            : formatEstimate(step.yen);
          return (
            <li key={step.key} className="text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span style={{ color: 'var(--ink-secondary)' }}>
                  {step.key === 'actual' ? '' : '+ '}
                  {step.label}
                </span>
                <span className="tabular" style={{ color: 'var(--ink)' }}>
                  {amount}
                </span>
              </div>
              <div
                aria-hidden
                className="relative mt-1 h-2 w-full rounded-full"
                style={{ background: 'var(--hairline)' }}
              >
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: pct(start),
                    width: `calc(${pct(cum)} - ${pct(start)})`,
                    background: step.fact ? 'var(--ink-muted)' : 'var(--income)',
                    opacity: step.fact ? 0.7 : 0.45,
                  }}
                />
              </div>
              {step.key === 'variable' && topVariable.length > 0 ? (
                <p className="tabular mt-1" style={{ color: 'var(--ink-muted)' }}>
                  うち{' '}
                  {topVariable.map((c) => `${c.categoryName} ${formatEstimate(c.yen)}`).join('、')}
                </p>
              ) : null}
            </li>
          );
        })}
        <li
          className="flex items-baseline justify-between gap-3 pt-2 text-sm font-semibold"
          style={{ borderTop: '1px solid var(--hairline)' }}
        >
          <span style={{ color: 'var(--ink)' }}>= {endLabel}の見込み</span>
          <span className="tabular" style={{ color: 'var(--ink)' }}>
            {formatEstimate(b.totalYen)}
          </span>
        </li>
      </ol>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        濃い棒は事実(使った額・決まっている額)、薄い棒は見込み。見込みの内訳は、それぞれの平均の比で配っている(合計は中央の見込みと同じ)。
      </p>
    </section>
  );
}

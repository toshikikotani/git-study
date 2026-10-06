import {
  CAUTION_EXCEEDANCE,
  formatEstimate,
  formatEstimateRange,
  formatProbability,
} from '@/domain/forecast/format';
import type { LandingRow } from '@/domain/forecast/landing-rows';
import { formatYen } from '@/domain/money';

export type { LandingRow };

/**
 * ジャンルごとの着地の幅(10回中8回の範囲)。目標があれば「目標」の目盛りと超える確率を添える。
 * 目印:濃い棒=決まっている額、帯=10回中8回、点=中央、目盛り=目標(設計書 v3 2.2 の4)。
 */
export function LandingRangesCard({
  rows,
  periodLabel,
}: {
  rows: LandingRow[];
  periodLabel: string;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => Math.max(r.p90, r.targetYen ?? 0, r.baseYen)), 1);
  const pct = (yen: number) => `${Math.min(100, (yen / max) * 100)}%`;
  return (
    <section
      aria-label="ジャンルごとの着地の幅"
      className="rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {periodLabel}の着地(ジャンル別)
      </p>
      <ul className="mt-3 space-y-4">
        {rows.map((row) => {
          const caution =
            row.status === 'forecast' &&
            row.exceedance !== null &&
            row.exceedance >= CAUTION_EXCEEDANCE;
          const statusText =
            row.status === 'closed'
              ? '予測を止めています'
              : row.status === 'settled'
                ? '確定(この先の見込みなし)'
                : null;
          return (
            <li key={row.genreId}>
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className="min-w-0 truncate text-sm font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  {row.name}
                </span>
                <span className="tabular shrink-0 text-sm" style={{ color: 'var(--ink)' }}>
                  {caution ? (
                    <span
                      className="mr-2 text-xs font-semibold"
                      style={{ color: 'var(--state-caution)' }}
                    >
                      注意
                    </span>
                  ) : null}
                  {row.status === 'forecast'
                    ? formatEstimate(row.p50)
                    : formatYen(row.p50, { sign: 'never' })}
                </span>
              </div>
              <div
                role="img"
                aria-label={`${row.name}の着地は、${
                  statusText ??
                  `中央 ${formatEstimate(row.p50)}、10回中8回 ${formatEstimateRange(row.p10, row.p90)}`
                }${row.targetYen !== null ? `。目標 ${formatYen(row.targetYen, { sign: 'never' })}` : ''}`}
                className="relative mt-3 h-3 w-full rounded-full"
                style={{ background: 'var(--hairline)' }}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: pct(row.baseYen), background: 'var(--ink-muted)', opacity: 0.55 }}
                />
                {row.status === 'forecast' ? (
                  <>
                    <span
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        left: pct(row.p10),
                        width: `calc(${pct(row.p90)} - ${pct(row.p10)})`,
                        background: 'var(--income)',
                        opacity: 0.35,
                      }}
                    />
                    <span
                      aria-hidden
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        left: pct(row.p50),
                        background: 'var(--income)',
                        boxShadow: '0 0 0 2px var(--surface-raised)',
                      }}
                    />
                  </>
                ) : null}
                {row.targetYen !== null ? (
                  <span
                    aria-hidden
                    className="absolute -inset-y-1 w-0.5"
                    style={{ left: pct(row.targetYen), background: 'var(--ink)' }}
                  >
                    <span
                      className="absolute -top-4 left-1/2 -translate-x-1/2 text-xs leading-none whitespace-nowrap"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      目標
                    </span>
                  </span>
                ) : null}
              </div>
              <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {statusText ?? formatEstimateRange(row.p10, row.p90)}
                {row.exceedance !== null && row.targetYen !== null && row.status === 'forecast'
                  ? ` ・ 目標 ${formatYen(row.targetYen, { sign: 'never' })} を超える確率 ${formatProbability(row.exceedance)}`
                  : row.targetYen !== null
                    ? ` ・ 目標 ${formatYen(row.targetYen, { sign: 'never' })}`
                    : ''}
              </p>
              {row.excludedYen > 0 ? (
                <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  うち {formatYen(row.excludedYen, { sign: 'never' })} は目標の対象外(特別費)
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        濃い棒はもう決まっている額、帯は10回中8回の範囲、点は中央、「目標」の目盛りは目標。超える確率が20%以上のジャンルに「注意」。
      </p>
    </section>
  );
}

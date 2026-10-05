import { CAUTION_EXCEEDANCE, formatProbability } from '@/domain/forecast/format';
import { formatYen } from '@/domain/money';

export type LandingRow = {
  genreId: string;
  name: string;
  /** すでに決まっている額(実績・予定・固定費)。 */
  baseYen: number;
  p10: number;
  p50: number;
  p90: number;
  targetYen: number | null;
  exceedance: number | null;
};

/** ジャンルごとの着地の幅(10回中8回の範囲)。目標があれば目盛りと超える確率を添える。 */
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
        {rows.map((row) => (
          <li key={row.genreId}>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className="min-w-0 truncate text-sm font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                {row.name}
              </span>
              <span className="tabular shrink-0 text-sm" style={{ color: 'var(--ink)' }}>
                {row.exceedance !== null && row.exceedance >= CAUTION_EXCEEDANCE ? (
                  <span
                    className="mr-2 text-xs font-semibold"
                    style={{ color: 'var(--state-caution)' }}
                  >
                    注意
                  </span>
                ) : null}
                {formatYen(row.p50, { sign: 'never' })}
              </span>
            </div>
            <div
              role="img"
              aria-label={`${row.name}の着地は、10回中8回 ${formatYen(row.p10, { sign: 'never' })} から ${formatYen(row.p90, { sign: 'never' })}${
                row.targetYen !== null
                  ? `。目標 ${formatYen(row.targetYen, { sign: 'never' })}`
                  : ''
              }`}
              className="relative mt-2 h-3 w-full rounded-full"
              style={{ background: 'var(--hairline)' }}
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: pct(row.baseYen), background: 'var(--ink-muted)', opacity: 0.55 }}
              />
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
                className="absolute inset-y-0 w-0.5"
                style={{ left: pct(row.p50), background: 'var(--income)' }}
              />
              {row.targetYen !== null ? (
                <span
                  className="absolute -inset-y-1 w-0.5"
                  style={{ left: pct(row.targetYen), background: 'var(--ink)' }}
                />
              ) : null}
            </div>
            <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
              {formatYen(row.p10, { sign: 'never' })} 〜 {formatYen(row.p90, { sign: 'never' })}
              {row.exceedance !== null && row.targetYen !== null
                ? ` ・ 目標 ${formatYen(row.targetYen, { sign: 'never' })} を超える確率 ${formatProbability(row.exceedance)}`
                : ''}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        濃い部分はもう決まっている額、帯は下振れ〜上振れ(10回中8回の範囲)、縦線は中央。超える確率が20%以上のジャンルに「注意」。
      </p>
    </section>
  );
}

import Link from 'next/link';

import { formatSignedYen } from '@/domain/budget-state';
import { formatEstimateRange, formatSignedEstimate } from '@/domain/forecast/format';
import { formatYen } from '@/domain/money';

/**
 * 月のレポートの上部(N4本人要件「上部に支出・収入・収支を並べる。収入が
 * 未登録なら収支は出さず、収入を登録への導線にする」)。
 *
 * 収支は「月末の見込み」を主にする(設計書 v3 2.2 の3)。収入は1か月分なので、今日までの
 * 支出で引くと、月初ほど大きなプラスに見える。今日までの値は小さく添える。
 */
export function MonthSummaryRow({
  spentYen,
  incomeYen,
  incomeRegistered,
  balance = null,
}: {
  spentYen: number;
  incomeYen: number;
  incomeRegistered: boolean;
  /** 今月の全部の予測から出した、月末の収支の見込み(収入 − 着地)。 */
  balance?: { p10: number; p50: number; p90: number } | null;
}) {
  return (
    <section aria-label="今月のすべての支出と収入" className="space-y-2">
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        今月(すべての支出)
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="支出" value={formatYen(spentYen, { sign: 'never' })} color="var(--over)" />
        {incomeRegistered ? (
          <>
            <Tile
              label="収入"
              value={formatYen(incomeYen, { sign: 'never' })}
              color="var(--income)"
            />
            {balance ? (
              <Tile
                label="月末の見込み"
                value={formatSignedEstimate(balance.p50)}
                color="var(--ink)"
                sub={`今日まで ${formatSignedYen(incomeYen - spentYen)}`}
                title={`10回中8回 ${formatEstimateRange(balance.p10, balance.p90)}`}
              />
            ) : (
              <Tile
                label="今日までの収支"
                value={formatSignedYen(incomeYen - spentYen)}
                color="var(--ink)"
              />
            )}
          </>
        ) : (
          <div
            className="glass col-span-2 flex items-center justify-center rounded-2xl p-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
          >
            <Link
              href="/transactions/new?type=income"
              prefetch={false}
              className="min-h-11 flex items-center text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              収入を登録すると収支が見られます →
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  color,
  sub,
  title,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
  title?: string;
}) {
  return (
    <div
      className="glass rounded-2xl p-3"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </p>
      <p className="tabular mt-1 text-sm font-semibold" style={{ color }} title={title}>
        {value}
      </p>
      {sub ? (
        <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

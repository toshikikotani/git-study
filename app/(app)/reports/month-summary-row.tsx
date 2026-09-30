import Link from 'next/link';

import { formatSignedYen } from '@/domain/budget-state';
import { formatYen } from '@/domain/money';

/**
 * 月のレポートの上部(N4本人要件「上部に支出・収入・収支を並べる。収入が
 * 未登録なら収支は出さず、収入を登録への導線にする」)。
 */
export function MonthSummaryRow({
  spentYen,
  incomeYen,
  incomeRegistered,
}: {
  spentYen: number;
  incomeYen: number;
  incomeRegistered: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Tile label="支出" value={formatYen(spentYen, { sign: 'never' })} color="var(--over)" />
      {incomeRegistered ? (
        <>
          <Tile
            label="収入"
            value={formatYen(incomeYen, { sign: 'never' })}
            color="var(--income)"
          />
          <Tile label="収支" value={formatSignedYen(incomeYen - spentYen)} color="var(--ink)" />
        </>
      ) : (
        <div
          className="col-span-2 flex items-center justify-center rounded-2xl p-3"
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
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </p>
      <p className="tabular mt-1 text-sm font-semibold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

import { Meter } from '@/components/ui/meter';
import { formatYen } from '@/domain/money';
import type { CategoryBreakdownRow } from '@/features/spending/store';

/**
 * 今月のカテゴリ別内訳(本人発案:「普通の家計簿」への作り直し)。
 *
 * 予算があるカテゴリは既存の Meter(components/ui/meter.tsx)をそのまま使い、
 * 「予算に対してどれだけ使ったか」を示す(ホームの予算タイルと同じ色・
 * 判断ロジック=domain/budget.ts の budgetTone()、サーバー側で計算済みの
 * `tone` を受け取るだけ)。予算が無いカテゴリ(投資・返済など)は比較対象が
 * 無いため、単純に「このカテゴリの中での大きさ」を表す中立のバーにする。
 */
export function CategoryBreakdownChart({ rows }: { rows: readonly CategoryBreakdownRow[] }) {
  if (rows.length === 0) return null;

  const totalYen = rows.reduce((acc, row) => acc + row.spentYen, 0);
  const maxSpentYen = Math.max(...rows.map((row) => row.spentYen), 1);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        カテゴリ別の内訳
      </p>

      <ul className="mt-3 space-y-3.5">
        {rows.map((row) => {
          const ratio =
            row.budgetYen !== null && row.budgetYen > 0 ? row.spentYen / row.budgetYen : null;
          const shareOfTotal = totalYen > 0 ? Math.round((row.spentYen / totalYen) * 100) : 0;

          return (
            <li key={row.categoryId ?? 'uncategorized'}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm" style={{ color: 'var(--ink)' }}>
                  {row.categoryName}
                </span>
                <span className="tabular shrink-0 text-sm" style={{ color: 'var(--ink)' }}>
                  {formatYen(row.spentYen, { sign: 'never' })}
                </span>
              </div>

              <div className="mt-1.5">
                {ratio !== null ? (
                  <Meter
                    ratio={ratio}
                    tone={row.tone}
                    label={`${row.categoryName} 予算の${Math.round(ratio * 100)}%`}
                  />
                ) : (
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full"
                    style={{ background: 'var(--over-track)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round((row.spentYen / maxSpentYen) * 100)}%`,
                        background: 'var(--over)',
                      }}
                    />
                  </div>
                )}
              </div>

              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {row.budgetYen !== null
                  ? `予算 ${formatYen(row.budgetYen, { sign: 'never' })} の ${Math.round(
                      (ratio ?? 0) * 100,
                    )}%`
                  : `支出全体の${shareOfTotal}%`}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

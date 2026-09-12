import { formatYen } from '@/domain/money';
import type { CategorySpendingTrend } from '@/features/reports/store';

/**
 * カテゴリ別支出推移(P6-2)。
 *
 * ── なぜカテゴリに色を割り当てないか(app/globals.css の設計判断を継承)──
 * カテゴリは本人が増減できるため固定の色順が成立せず、暗いサーフェスでは
 * 隣接する色相が識別できない組み合わせが出る(globals.css 冒頭のコメント参照)。
 * そのため色は「支出」という役割にだけ割り当て(var(--over)。予算超過と同じ
 * 「お金が出ていく」役割の色を再利用)、カテゴリの識別は名前(小さな複数=
 * small multiples)で行う。dataviz スキルの「9個目以降は Other か
 * small multiples へ折り込む」の考え方を、最初から全カテゴリに適用した形。
 *
 * ── インタラクション ────────────────────────────────────────
 * 本アプリの既存メーター類(components/ui/meter.tsx)と同じくCSSのみで組み、
 * バー単位の正確な値は title 属性のネイティブツールチップで補う。最大の月
 * だけ直接ラベルを添える(marks-and-anatomy:「全点にラベルは付けない」)。
 * 正確な数値は下の表(アクセシビリティ用の table view)で確認できる。
 */
export function CategoryTrendChart({ trend }: { trend: CategorySpendingTrend }) {
  const { monthKeys, categories, rows } = trend;
  const rowsByCategoryAndMonth = new Map(
    rows.map((row) => [`${row.categoryId}:${row.monthKey}`, row.spentYen]),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {categories.map((category) => {
          const values = monthKeys.map(
            (monthKey) => rowsByCategoryAndMonth.get(`${category.id}:${monthKey}`) ?? 0,
          );
          const totalYen = values.reduce((sum, v) => sum + v, 0);
          const maxYen = Math.max(...values, 1);
          const peakIndex = values.lastIndexOf(Math.max(...values));

          return (
            <div
              key={category.id}
              className="rounded-[22px] p-5"
              style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  {category.name}
                </span>
                <span className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
                  6ヶ月合計 {formatYen(totalYen)}
                </span>
              </div>

              <div className="mt-4 flex h-24 items-end gap-[2px]">
                {values.map((spentYen, index) => {
                  const percent = Math.round((spentYen / maxYen) * 100);
                  return (
                    <div
                      key={monthKeys[index]}
                      className="relative h-full flex-1 overflow-hidden rounded-t-[4px]"
                      style={{ background: 'var(--over-track)' }}
                      title={`${monthLabel(monthKeys[index]!)}: ${formatYen(spentYen)}`}
                    >
                      {index === peakIndex && spentYen > 0 ? (
                        <span
                          className="tabular absolute inset-x-0 -top-4 text-center text-[9px]"
                          style={{ color: 'var(--ink-muted)' }}
                          aria-hidden
                        >
                          {formatYen(spentYen)}
                        </span>
                      ) : null}
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-t-[4px]"
                        style={{ height: `${percent}%`, background: 'var(--over)' }}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="mt-1.5 flex gap-[2px]">
                {monthKeys.map((monthKey) => (
                  <span
                    key={monthKey}
                    className="tabular flex-1 text-center text-[10px]"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {monthLabel(monthKey)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <SpendingTable trend={trend} />
    </div>
  );
}

/** アクセシビリティ用の表(dataviz: table view は必ず用意する)。 */
function SpendingTable({ trend }: { trend: CategorySpendingTrend }) {
  const { monthKeys, categories, rows } = trend;
  const rowsByCategoryAndMonth = new Map(
    rows.map((row) => [`${row.categoryId}:${row.monthKey}`, row.spentYen]),
  );

  return (
    <div className="overflow-x-auto rounded-[16px]" style={{ background: 'var(--surface)' }}>
      <table className="w-full text-xs">
        <caption className="sr-only">カテゴリ別・月別支出額の表</caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--hairline)' }}>
            <th className="p-2.5 text-left font-medium" style={{ color: 'var(--ink-muted)' }}>
              カテゴリ
            </th>
            {monthKeys.map((monthKey) => (
              <th
                key={monthKey}
                className="p-2.5 text-right font-medium"
                style={{ color: 'var(--ink-muted)' }}
              >
                {monthLabel(monthKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr key={category.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
              <td className="p-2.5" style={{ color: 'var(--ink)' }}>
                {category.name}
              </td>
              {monthKeys.map((monthKey) => (
                <td
                  key={monthKey}
                  className="tabular p-2.5 text-right"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {formatYen(rowsByCategoryAndMonth.get(`${category.id}:${monthKey}`) ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function monthLabel(monthKey: string): string {
  return `${Number(monthKey.slice(5, 7))}月`;
}

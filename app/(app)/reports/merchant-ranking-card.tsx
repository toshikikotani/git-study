import { formatYen } from '@/domain/money';
import type { MerchantRanking } from '@/features/reports/store';

/**
 * 店舗別支出ランキング(分析系拡充、本人発案)。
 *
 * ── ちりつも(/spending)との違い ────────────────────────────────
 * ちりつもの「小口の山」(domain/accumulation.ts)は1,000円未満だけを対象に
 * 「回数」で積もりを見せる。こちらは金額を絞らず、家賃・保険のような大口の
 * 定期支払いも含めて「結局どこに一番使っているか」を金額順に見せる、別の切り口。
 *
 * ── 色について ────────────────────────────────────────────────
 * 単一系列(支出額)の大きさを表すだけなので、カテゴリ別支出推移(P6-2)と
 * 同じ判断で「支出」の役割色 var(--over) 一色を使う(店ごとに色を割り当てない)。
 */
export function MerchantRankingCard({ ranking }: { ranking: MerchantRanking }) {
  const { monthsBack, merchants } = ranking;

  if (merchants.length === 0) {
    return (
      <div
        className="rounded-[22px] p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          店舗別支出ランキング
        </h2>
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          直近{monthsBack}ヶ月に支出の記録がありません。
        </p>
      </div>
    );
  }

  const maxYen = Math.max(...merchants.map((m) => m.totalYen), 1);

  return (
    <div
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          店舗別支出ランキング
        </h2>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          直近{monthsBack}ヶ月・上位{merchants.length}件
        </span>
      </div>

      <ol className="mt-4 space-y-3">
        {merchants.map((merchant, index) => {
          const percent = Math.round((merchant.totalYen / maxYen) * 100);
          return (
            <li key={merchant.label}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="tabular shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    {index + 1}位
                  </span>
                  <span className="truncate font-medium" style={{ color: 'var(--ink)' }}>
                    {merchant.label}
                  </span>
                  <span className="tabular shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    {merchant.count}回
                  </span>
                </span>
                <span className="tabular shrink-0 font-medium" style={{ color: 'var(--ink)' }}>
                  {formatYen(merchant.totalYen)}
                </span>
              </div>
              <div
                className="mt-1 h-2 overflow-hidden rounded-full"
                style={{ background: 'var(--over-track)' }}
                title={`${merchant.label}: ${formatYen(merchant.totalYen)}(${merchant.count}回)`}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${percent}%`, background: 'var(--over)' }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

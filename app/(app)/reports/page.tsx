import { CategoryTrendChart } from './category-trend-chart';
import { NetWorthChart } from './net-worth-chart';
import { loadCategorySpendingTrend } from '@/features/reports/store';
import { loadNetWorthTrend } from '@/features/net-worth/store';

// 直近6ヶ月の集計は都度 transactions から出す(スナップショットの保存機構が無い)。
// キャッシュに乗せると取り込み直後の反映が遅れる(ADR-001と同じ考え方)。
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const [trend, netWorthPoints] = await Promise.all([
    loadCategorySpendingTrend(),
    // net_worth_snapshots は本番マイグレーション未適用の間、テーブル自体が
    // 無く失敗する(TASKS.md のブロック事項参照)。本人にとっては「記録が
    // まだ無い」のと同じなので、レポート画面全体を落とさず空状態にする。
    loadNetWorthTrend().catch(() => []),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          支出レポート
        </h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
          直近6ヶ月のカテゴリ別支出
        </p>
      </header>

      {trend.categories.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          直近6ヶ月に支出の記録がありません。
        </p>
      ) : (
        <CategoryTrendChart trend={trend} />
      )}

      <NetWorthChart points={netWorthPoints} />
    </div>
  );
}

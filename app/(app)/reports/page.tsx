import Link from 'next/link';

import { CategoryTrendChart } from './category-trend-chart';
import { IncomeExpenseChart } from './income-expense-chart';
import { MerchantRankingCard } from './merchant-ranking-card';
import { NetWorthChart } from './net-worth-chart';
import { PurposeBalanceCard } from './purpose-balance-card';
import {
  loadAccountBalanceByPurpose,
  loadCategorySpendingTrend,
  loadIncomeExpenseTrend,
  loadMerchantSpendingRanking,
} from '@/features/reports/store';
import { loadNetWorthTrend } from '@/features/net-worth/store';
import { withMinDuration } from '@/lib/min-loading-duration';

// 直近6ヶ月の集計は都度 transactions から出す(スナップショットの保存機構が無い)。
// キャッシュに乗せると取り込み直後の反映が遅れる(ADR-001と同じ考え方)。
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const [trend, netWorthPoints, incomeExpenseTrend, merchantRanking, purposeBalances] =
    await withMinDuration(
      Promise.all([
        loadCategorySpendingTrend(),
        // net_worth_snapshots は本番マイグレーション未適用の間、テーブル自体が
        // 無く失敗する(TASKS.md のブロック事項参照)。本人にとっては「記録が
        // まだ無い」のと同じなので、レポート画面全体を落とさず空状態にする。
        loadNetWorthTrend().catch(() => []),
        loadIncomeExpenseTrend(),
        loadMerchantSpendingRanking(),
        loadAccountBalanceByPurpose(),
      ]),
    );

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            支出レポート
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            収支・カテゴリ別支出・店舗別支出・資産推移・用途別残高
          </p>
        </div>
        <Link href="/reports/ai" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          AIレポート →
        </Link>
      </header>

      <IncomeExpenseChart trend={incomeExpenseTrend} />

      {trend.categories.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          直近6ヶ月に支出の記録がありません。
        </p>
      ) : (
        <CategoryTrendChart trend={trend} />
      )}

      <MerchantRankingCard ranking={merchantRanking} />

      <NetWorthChart points={netWorthPoints} />

      <PurposeBalanceCard balances={purposeBalances} />
    </div>
  );
}

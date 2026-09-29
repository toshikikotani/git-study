/**
 * 目標の読み込み(サーバー)。直近の目標と、その期間の家計簿の明細から
 * GoalView を作る。明細の読み方・集計は家計簿と同じ(entries.ts / domain/ledger.ts)。
 */

import { loadLedgerTransactions } from '@/features/spending/entries';
import { toLedgerEntries } from '@/features/spending/views';
import { getLatestPlan, type SpendingPlan } from '@/features/spending-plan/store';
import { todayJst } from '@/lib/date';
import { buildGoalView, type GoalView } from './view';

export async function loadGoalView(
  now: Date = new Date(),
): Promise<{ plan: SpendingPlan; view: GoalView } | null> {
  const plan = await getLatestPlan();
  if (plan === null) return null;
  const today = todayJst(now);
  const { genres, transactions } = await loadLedgerTransactions(
    { from: plan.periodStart, to: plan.periodEnd },
    today,
  );
  const view = buildGoalView({
    plan,
    entries: toLedgerEntries(transactions),
    genreNames: new Map(genres.map((g) => [g.id, g.name])),
    today,
    transactions,
  });
  return { plan, view };
}

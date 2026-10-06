/**
 * 目標の読み込み(サーバー)。直近の目標と、その期間の家計簿の明細から
 * GoalView を作る。明細の読み方・集計は家計簿と同じ(entries.ts / domain/ledger.ts)。
 */

import { cache } from 'react';

import { loadLedgerTransactions } from '@/features/spending/entries';
import { toLedgerEntries } from '@/features/spending/views';
import { getCurrentPlan, type SpendingPlan } from '@/features/spending-plan/store';
import { todayJst } from '@/lib/date';
import { buildGoalView, type GoalView } from './view';

export type LoadedGoalView = { plan: SpendingPlan; view: GoalView };

async function loadGoalViewAt(now: Date): Promise<LoadedGoalView | null> {
  const today = todayJst(now);
  const plan = await getCurrentPlan(today);
  if (plan === null) return null;
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

/** 同じ描画の中で何度呼んでも読み込みは1回(目標のページは複数の部品が同じ目標を使う)。 */
const loadCurrentGoalView = cache(() => loadGoalViewAt(new Date()));

export function loadGoalView(now?: Date): Promise<LoadedGoalView | null> {
  return now === undefined ? loadCurrentGoalView() : loadGoalViewAt(now);
}

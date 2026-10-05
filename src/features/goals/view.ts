/**
 * 目標(期間つきの支出目標、ADR-058)を家計簿・目標画面で見せる形に整える純粋関数。
 * 集計は家計簿と同じ domain/ledger.ts の summarizeLedger()で、画面ごとに足し直さない。
 */

import { budgetState, type BudgetState } from '@/domain/budget-state';
import type { GoalSnapshot } from '@/domain/goal-impact';
import { buildGoalReview, type GoalReview } from '@/domain/goal-review';
import { summarizeLedger, type LedgerEntry } from '@/domain/ledger';
import { planGuidance, type PlanGuidance } from '@/domain/spending-plan';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import type { DateOnly } from '@/lib/date';

export type GoalBreakdownRow = {
  genreId: string | null;
  genreName: string;
  spentYen: number;
  targetYen: number | null;
  idealYen: number | null;
  scheduledYen: number;
  reserved: boolean;
};

export function dayStatus(spentYen: number, dailyAllowanceYen: number | null): BudgetState | null {
  if (dailyAllowanceYen === null || dailyAllowanceYen <= 0) return null;
  return budgetState({ spentYen, budgetYen: dailyAllowanceYen });
}

export type GoalPlanInput = {
  id: string;
  periodStart: DateOnly;
  periodEnd: DateOnly;
  items: readonly { genreId: string; genreName: string; targetYen: number }[];
};

export type GoalView = {
  planId: string;
  range: { from: DateOnly; to: DateOnly };
  active: boolean;
  ended: boolean;
  guidance: PlanGuidance;
  snapshot: GoalSnapshot;
  breakdown: GoalBreakdownRow[];
  noBudget: { genreId: string | null; genreName: string; spentYen: number }[];
  dailyAllowanceYen: number | null;
  review: GoalReview | null;
  uncategorizedYen: number;
  scheduledItems: {
    id: string;
    date: DateOnly;
    label: string;
    genreName: string | null;
    amountYen: number;
  }[];
};

export function buildGoalView(input: {
  plan: GoalPlanInput;
  entries: readonly LedgerEntry[];
  genreNames: ReadonlyMap<string, string>;
  today: DateOnly;
  transactions?: readonly LedgerTransaction[];
}): GoalView {
  const { plan, entries, genreNames, today } = input;
  const range = { from: plan.periodStart, to: plan.periodEnd };
  const summary = summarizeLedger(entries, range, today);
  const todaySummary = summarizeLedger(entries, { from: today, to: today }, today);

  const guidance = planGuidance({
    periodStart: plan.periodStart,
    periodEnd: plan.periodEnd,
    today,
    items: plan.items.map((item) => ({
      genreId: item.genreId,
      genreName: item.genreName,
      targetYen: item.targetYen,
      spentYen: summary.byGenrePace.get(item.genreId) ?? 0,
      todaySpentYen: todaySummary.byGenrePace.get(item.genreId) ?? 0,
      scheduledYen: summary.scheduledByGenre.get(item.genreId) ?? 0,
    })),
    specialYen: summary.specialYen,
    scheduledYen: summary.scheduledYen,
    uncategorizedYen: summary.byGenrePace.get(null) ?? 0,
    uncategorizedTodayYen: todaySummary.byGenrePace.get(null) ?? 0,
  });

  // 目標が0円のジャンルは「予算なし」。実績があれば未収録に出し、見えなくしない。
  const planned = new Set(plan.items.filter((i) => i.targetYen > 0).map((i) => i.genreId));
  const breakdown: GoalBreakdownRow[] = guidance.genres
    .filter((g) => g.status !== 'no_budget')
    .map((g) => ({
      genreId: g.genreId,
      genreName: g.genreName,
      spentYen: g.spentYen,
      targetYen: g.targetYen,
      idealYen: g.idealYen,
      scheduledYen: g.scheduledYen,
      reserved: g.status === 'reserved',
    }));
  const noBudget: GoalView['noBudget'] = [];
  for (const [genreId, spentYen] of summary.byGenrePace) {
    if (genreId !== null && planned.has(genreId)) continue;
    if (spentYen <= 0) continue;
    noBudget.push({
      genreId,
      genreName: genreId === null ? '未分類' : (genreNames.get(genreId) ?? '不明なジャンル'),
      spentYen,
    });
  }
  noBudget.sort((a, b) => b.spentYen - a.spentYen);
  for (const row of noBudget) {
    breakdown.push({
      genreId: row.genreId,
      genreName: row.genreName,
      spentYen: row.spentYen,
      targetYen: null,
      idealYen: null,
      scheduledYen: 0,
      reserved: false,
    });
  }

  const ended = today > plan.periodEnd;
  const budgeted = plan.items.filter((i) => i.targetYen > 0);
  const targetTotal = budgeted.reduce((a, i) => a + i.targetYen, 0);
  const days = guidance.totalDays;

  return {
    planId: plan.id,
    range,
    active: today >= plan.periodStart && !ended,
    ended,
    guidance,
    snapshot: {
      range,
      scheduledYen: guidance.scheduledYen,
      genres: plan.items.map((i) => ({
        genreId: i.genreId,
        genreName: i.genreName,
        targetYen: i.targetYen,
        spentYen: summary.byGenrePace.get(i.genreId) ?? 0,
      })),
    },
    breakdown,
    noBudget,
    dailyAllowanceYen:
      targetTotal > 0 ? Math.floor(Math.max(targetTotal - guidance.scheduledYen, 0) / days) : null,
    review: ended
      ? buildGoalReview({
          items: plan.items,
          actualByGenre: new Map(
            plan.items.map((i) => [i.genreId, summary.byGenrePace.get(i.genreId) ?? 0]),
          ),
        })
      : null,
    uncategorizedYen: summary.byGenrePace.get(null) ?? 0,
    scheduledItems: (input.transactions ?? [])
      .filter(
        (t) =>
          t.occurredOn > today &&
          t.occurredOn <= plan.periodEnd &&
          t.amountYen < 0 &&
          !t.isTransfer &&
          t.reviewStatus !== 'ignored' &&
          !t.needsInput,
      )
      .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))
      .map((t) => ({
        id: t.id,
        date: t.occurredOn,
        label: t.label,
        genreName: t.genreName,
        amountYen: -t.amountYen,
      })),
  };
}

export function goalRowState(row: {
  spentYen: number;
  targetYen: number | null;
  idealYen: number | null;
}): BudgetState {
  return budgetState({ spentYen: row.spentYen, budgetYen: row.targetYen, idealYen: row.idealYen });
}

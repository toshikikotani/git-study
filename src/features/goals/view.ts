/**
 * 目標(期間つきの支出目標、ADR-058)を家計簿・目標画面で見せる形に整える純粋関数。
 * 集計は家計簿と同じ domain/ledger.ts の summarizeLedger()(特別費・予定は除いた
 * ペースの値)を使い、画面ごとに足し直さない。DB には触れない。
 */

import { budgetState, type BudgetState } from '@/domain/budget-state';
import type { GoalSnapshot } from '@/domain/goal-impact';
import { buildGoalReview, type GoalReview } from '@/domain/goal-review';
import { summarizeLedger, type LedgerEntry } from '@/domain/ledger';
import { planGuidance, type PlanGuidance } from '@/domain/spending-plan';
import type { DateOnly } from '@/lib/date';

/** 家計簿のジャンル内訳(目標期間の切り替え)で使う1行。 */
export type GoalBreakdownRow = {
  genreId: string | null;
  genreName: string;
  spentYen: number;
  /** 目標額。目標に無いジャンルは null(予算なし)。 */
  targetYen: number | null;
  /** 今日時点の理想ライン(目標を期間で均等に使った額)。 */
  idealYen: number | null;
};

/**
 * カレンダーの各日に付ける、1日の目安に対する状態の点。
 * 目安(1日の目安 = 目標の合計 ÷ 期間の日数)に対して、その日の支出が
 * 80%未満=余裕、100%まで=注意、超えたら=超過。目安が無ければ null(点を付けない)。
 */
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
  /** 期間中(開始日〜終了日、今日を含む)か。終了後は振り返りを見せる。 */
  active: boolean;
  ended: boolean;
  guidance: PlanGuidance;
  /** レシート保存時の影響計算に使う、今の目標と実績。 */
  snapshot: GoalSnapshot;
  /** 家計簿のジャンル内訳(目標期間)の行。目標に無いジャンルは目標なし(予算なし)。 */
  breakdown: GoalBreakdownRow[];
  /** 目標に入れていないジャンルの実績(折りたたんで見せる)。 */
  noBudget: { genreId: string | null; genreName: string; spentYen: number }[];
  /** カレンダーの「1日の目安」(目標の合計 ÷ 期間の日数)。 */
  dailyAllowanceYen: number | null;
  /** 期間が終わっているときだけ。 */
  review: GoalReview | null;
  /** 未分類の実績(目標に未反映)。 */
  uncategorizedYen: number;
};

/**
 * 目標 + 家計簿の明細(分割の子へ展開済み)から、画面に出す形を作る。
 * 実績は特別費・予定を除いたペースの値(byGenrePace)。特別費・予定は別の行で見せる。
 */
export function buildGoalView(input: {
  plan: GoalPlanInput;
  entries: readonly LedgerEntry[];
  genreNames: ReadonlyMap<string, string>;
  today: DateOnly;
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
    })),
    specialYen: summary.specialYen,
    scheduledYen: summary.scheduledYen,
  });

  const planned = new Set(plan.items.filter((i) => i.targetYen > 0).map((i) => i.genreId));
  const breakdown: GoalBreakdownRow[] = guidance.genres
    .filter((g) => g.status !== 'no_budget')
    .map((g) => ({
      genreId: g.genreId,
      genreName: g.genreName,
      spentYen: g.spentYen,
      targetYen: g.targetYen,
      idealYen: g.idealYen,
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
      genres: plan.items.map((i) => ({
        genreId: i.genreId,
        genreName: i.genreName,
        targetYen: i.targetYen,
        spentYen: summary.byGenrePace.get(i.genreId) ?? 0,
      })),
    },
    breakdown,
    noBudget,
    dailyAllowanceYen: targetTotal > 0 ? Math.floor(targetTotal / days) : null,
    review: ended
      ? buildGoalReview({
          items: plan.items,
          actualByGenre: new Map(
            plan.items.map((i) => [i.genreId, summary.byGenrePace.get(i.genreId) ?? 0]),
          ),
        })
      : null,
    uncategorizedYen: summary.byGenrePace.get(null) ?? 0,
  };
}

/** 状態(目標画面の行・サマリーで使う)。予算なしはグレー。 */
export function goalRowState(row: {
  spentYen: number;
  targetYen: number | null;
  idealYen: number | null;
}): BudgetState {
  return budgetState({ spentYen: row.spentYen, budgetYen: row.targetYen, idealYen: row.idealYen });
}

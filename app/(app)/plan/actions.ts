'use server';

import { revalidatePath } from 'next/cache';

import type { PlanEvidence } from '@/domain/plan-evidence';
import { emptyPlanReason, PLAN_STEP_OPTIONS, planPeriodDays } from '@/domain/spending-plan';
import { loadPlanContext } from '@/features/spending-plan/context';
import { suggestPlanTargets, type PlanSuggestionItem } from '@/features/spending-plan/plan-ai';
import { genreForecastsFrom, landingReport, type LandingReport } from '@/domain/plan-forecast';
import { loadForecast } from '@/features/forecast/load';
import { listGenres } from '@/features/genre/store';
import {
  deletePlan,
  savePlan,
  updatePlanTargets,
  loadGenreSpend,
} from '@/features/spending-plan/store';
import type { GoalSnapshot } from '@/domain/goal-impact';
import { nextPlanTargets } from '@/domain/goal-review';
import { loadGoalView } from '@/features/goals/loader';
import {
  addDays,
  addMonths,
  assertDateOnly,
  daysBetween,
  monthStartJst,
  todayJst,
} from '@/lib/date';
import { describeUserError } from '@/lib/errors';
import { readAnthropicApiKey } from '@/lib/env';

const MAX_PERIOD_DAYS = 366;

export type SuggestPlanResult =
  | {
      error: null;
      items: PlanSuggestionItem[];
      summary: string;
      warnings: string[];
      usedAi: boolean;
      lookbackDays: number;
      uncategorizedYen: number;
      evidence: PlanEvidence;
      medianByGenre: Record<string, number>;
    }
  | { error: string; needsGenres?: boolean };

function isStepOption(value: number): value is (typeof PLAN_STEP_OPTIONS)[number] {
  return (PLAN_STEP_OPTIONS as readonly number[]).includes(value);
}

export async function suggestPlanAction(
  periodStart: string,
  periodEnd: string,
  stepPercent: number,
): Promise<SuggestPlanResult> {
  try {
    const start = assertDateOnly(periodStart);
    const end = assertDateOnly(periodEnd);
    if (end < start) return { error: '終了日は開始日以降を選んでください' };
    if (planPeriodDays(start, end) > MAX_PERIOD_DAYS) {
      return { error: '期間は1年以内にしてください' };
    }
    if (!isStepOption(stepPercent)) return { error: '改善の強さが正しくありません' };

    const context = await loadPlanContext(start, end);
    if (context.lookbackDays === 0) {
      return { error: 'まだ支出の記録が無いため、目標案を作れません。' };
    }
    const empty = emptyPlanReason({
      genreBaselines: context.genres.map((g) => g.baselineYen),
      uncategorizedYen: context.uncategorizedYen,
    });
    if (empty === 'unclassified') {
      return {
        error:
          '記録されている支出がまだジャンルに分類されていないため、ジャンルごとの目標案を作れません。先にジャンル分類をすると作れます。',
        needsGenres: true,
      };
    }
    if (empty === 'no-spend') {
      return { error: 'まだ分類済みの支出が無いため、目標案を作れません。' };
    }
    const suggestion = await suggestPlanTargets(readAnthropicApiKey(), context, stepPercent);
    return {
      error: null,
      items: suggestion.items,
      summary: suggestion.summary,
      warnings: suggestion.warnings,
      usedAi: suggestion.usedAi,
      lookbackDays: context.lookbackDays,
      uncategorizedYen: context.uncategorizedYen,
      evidence: context.evidence,
      medianByGenre: Object.fromEntries(context.genres.map((g) => [g.genreId, g.medianDailyYen])),
    };
  } catch (error) {
    return { error: describeUserError(error) };
  }
}

export async function savePlanAction(input: {
  periodStart: string;
  periodEnd: string;
  stepPercent: number;
  items: {
    genreId: string;
    targetYen: number;
    aiSuggestedYen: number | null;
    reason: string | null;
  }[];
}): Promise<{ error: string | null }> {
  try {
    await savePlan(input);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/plan');
  return { error: null };
}

export async function deletePlanAction(id: string): Promise<{ error: string | null }> {
  try {
    await deletePlan(id);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/plan');
  return { error: null };
}

export type PlanLandingResult = ({ error: null } & LandingReport) | { error: string };

/**
 * 今の支出と残りの予定と過去の傾向から、ジャンルごとの着地を返す。着地は確率エンジンの
 * 1本の予測から出す(レポートの着地と同じ予測)。
 */
export async function planLandingAction(input: {
  periodStart: string;
  periodEnd: string;
  items: { genreId: string; targetYen: number }[];
}): Promise<PlanLandingResult> {
  try {
    const start = assertDateOnly(input.periodStart);
    const end = assertDateOnly(input.periodEnd);
    if (end < start) return { error: '終了日は開始日以降を選んでください' };
    const today = todayJst();
    const thisMonth = monthStartJst();
    const previousStart = addMonths(thisMonth, -1);
    const priorStart = addMonths(thisMonth, -2);
    const validItems = input.items.filter(
      (item) => Number.isInteger(item.targetYen) && item.targetYen >= 0,
    );
    const genreNames = new Map((await listGenres()).map((genre) => [genre.id, genre.name]));
    const known = validItems.filter((item) => genreNames.has(item.genreId));
    const [{ forecast }, previousMonth, priorMonth] = await Promise.all([
      loadForecast({
        period: { from: start, to: end },
        budgetYen: known.reduce((sum, item) => sum + item.targetYen, 0),
        scope: { genreIds: new Set(known.map((item) => item.genreId)), excludeSpecial: true },
        categoryTargets: known.map((item) => ({
          categoryId: item.genreId,
          categoryName: genreNames.get(item.genreId) ?? '',
          targetYen: item.targetYen,
        })),
      }),
      loadGenreSpend(previousStart, addDays(thisMonth, -1)),
      loadGenreSpend(priorStart, addDays(previousStart, -1)),
    ]);
    const remainingDays = today >= end ? 0 : daysBetween(today, end);
    const byCategory = new Map(forecast.byCategory.map((c) => [c.categoryId, c]));
    const rows = known.map((item) => {
      const cat = byCategory.get(item.genreId);
      return {
        genreId: item.genreId,
        genreName: genreNames.get(item.genreId) ?? '',
        targetYen: item.targetYen,
        spentYen: cat?.actualYen ?? 0,
        scheduledYen: (cat?.scheduledYen ?? 0) + (cat?.fixedYen ?? 0),
        priorMonthYen: priorMonth.byGenre.get(item.genreId) ?? 0,
        previousMonthYen: previousMonth.byGenre.get(item.genreId) ?? 0,
      };
    });
    return {
      error: null,
      ...landingReport({
        remainingDays,
        rows,
        forecasts: genreForecastsFrom({ forecast, genres: rows, remainingDays }),
      }),
    };
  } catch (error) {
    return { error: describeUserError(error) };
  }
}

export async function updatePlanAllocationAction(
  planId: string,
  items: { genreId: string; targetYen: number }[],
): Promise<{ error: string | null }> {
  try {
    await updatePlanTargets(planId, items);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/plan');
  return { error: null };
}

export async function createNextPlanAction(planId: string): Promise<{ error: string | null }> {
  try {
    const loaded = await loadGoalView();
    if (loaded === null || loaded.plan.id !== planId || loaded.view.review === null) {
      return { error: '振り返りができる目標が見つかりません。' };
    }
    const { plan, view } = loaded;
    const days = planPeriodDays(plan.periodStart, plan.periodEnd);
    const start = addDays(plan.periodEnd, 1);
    const next = nextPlanTargets(view.review!);
    await savePlan({
      periodStart: start,
      periodEnd: addDays(start, days - 1),
      stepPercent: plan.stepPercent,
      items: plan.items
        .filter((i) => i.targetYen > 0)
        .map((i) => ({
          genreId: i.genreId,
          targetYen: next.get(i.genreId) ?? i.targetYen,
          aiSuggestedYen: null,
          reason: '前回の結果を反映した次の目標',
        })),
    });
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/plan');
  revalidatePath('/spending');
  return { error: null };
}

export async function loadGoalSnapshotAction(): Promise<{
  snapshot: GoalSnapshot | null;
  today: string;
}> {
  const today = todayJst();
  try {
    const loaded = await loadGoalView();
    if (loaded === null || !loaded.view.active) return { snapshot: null, today };
    return { snapshot: loaded.view.snapshot, today };
  } catch {
    return { snapshot: null, today };
  }
}

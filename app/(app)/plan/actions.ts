'use server';

import { revalidatePath } from 'next/cache';

import type { PlanEvidence } from '@/domain/plan-evidence';
import { PLAN_STEP_OPTIONS, planPeriodDays } from '@/domain/spending-plan';
import { loadPlanContext } from '@/features/spending-plan/context';
import { suggestPlanTargets, type PlanSuggestionItem } from '@/features/spending-plan/plan-ai';
import { forecastFromPace, type GenreForecast } from '@/domain/plan-forecast';
import { loadScheduledByGenre } from '@/features/spending-plan/scheduled';
import {
  deletePlan,
  savePlan,
  updatePlanTargets,
  loadGenreSpend,
} from '@/features/spending-plan/store';
import type { GoalSnapshot } from '@/domain/goal-impact';
import { nextPlanTargets } from '@/domain/goal-review';
import { loadGoalView } from '@/features/goals/loader';
import { addDays, assertDateOnly, daysBetween, todayJst } from '@/lib/date';
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
  | { error: string };

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

export type RefinePlanResult =
  | {
      error: null;
      summary: string;
      proposedTotalYen: number | null;
      forecasts: {
        genreId: string;
        genreName: string;
        spentYen: number;
        scheduledYen: number;
        medianYen: number | null;
        lowYen: number | null;
        highYen: number | null;
        label: string;
        detail: string;
      }[];
    }
  | { error: string };

/** 今の支出と残りの予定と直近ペースから、ジャンルごとの着地を返す。 */
export async function refinePlanAction(input: {
  periodStart: string;
  periodEnd: string;
  totalYen: number;
  items: { genreId: string; targetYen: number }[];
  instruction: string;
}): Promise<RefinePlanResult> {
  try {
    const start = assertDateOnly(input.periodStart);
    const end = assertDateOnly(input.periodEnd);
    if (end < start) return { error: '終了日は開始日以降を選んでください' };
    const today = todayJst();
    const context = await loadPlanContext(start, end);
    const spentTo = today < end ? today : end;
    const [spent, scheduled] = await Promise.all([
      loadGenreSpend(start, spentTo),
      loadScheduledByGenre(start, end),
    ]);
    const remaining = today >= end ? 0 : daysBetween(today, end);
    const byId = new Map(context.genres.map((genre) => [genre.genreId, genre]));
    const forecasts = input.items.flatMap((item) => {
      const genre = byId.get(item.genreId);
      if (genre === undefined || !Number.isInteger(item.targetYen) || item.targetYen < 0) return [];
      const spentYen = spent.byGenre.get(item.genreId) ?? 0;
      const scheduledYen = scheduled.get(item.genreId) ?? 0;
      const forecast: GenreForecast = forecastFromPace({
        spentYen,
        scheduledYen,
        paceYen: genre.medianDailyYen,
        observedDays: context.lookbackDays,
        remainingDays: remaining,
        targetYen: item.targetYen,
      });
      const yen = (n: number) => n.toLocaleString('ja-JP');
      const detail = [
        `この期間にすでに ${yen(spentYen)} 円使っている。`,
        scheduledYen > 0
          ? `これから日付の入っている予定が ${yen(scheduledYen)} 円ある。`
          : '日付の入っている予定は無い。',
        forecast.medianYen === null
          ? '支出のあった日が少なく、残りの着地はまだ置けない。'
          : `直近のペースが残りの ${remaining} 日続くと、着地は ${yen(forecast.medianYen)} 円、幅は ${yen(forecast.lowYen ?? forecast.medianYen)}〜${yen(forecast.highYen ?? forecast.medianYen)} 円。`,
        forecast.label,
      ].join('');
      return [
        {
          genreId: item.genreId,
          genreName: genre.genreName,
          spentYen,
          scheduledYen,
          medianYen: forecast.medianYen,
          lowYen: forecast.lowYen,
          highYen: forecast.highYen,
          label: forecast.label,
          detail,
        },
      ];
    });
    const known = forecasts.filter((row) => row.medianYen !== null);
    const landing = known.reduce((acc, row) => acc + (row.medianYen ?? 0), 0);
    const summary =
      known.length === 0
        ? 'まだ判断できるジャンルがありません。支出のあった日が少ないものは、予定があるときだけ着地に入れています。'
        : `このままの行動だと、判断できた ${known.length} ジャンルの合計は ${landing.toLocaleString('ja-JP')} 円に着く。いまの総額と違うときは、総額の方を着地に合わせてよい。予定は未来日の明細をジャンルごとに足している。`;
    return {
      error: null,
      summary,
      proposedTotalYen: known.length === 0 ? null : landing,
      forecasts,
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

'use server';

/**
 * 支出目標(/plan)の Server Action(本人発案、ADR-058)。
 * AI提案は本人が「AIに目標案を作ってもらう」を押した時だけ呼ぶ。
 */

import { revalidatePath } from 'next/cache';

import type { PlanEvidence } from '@/domain/plan-evidence';
import { PLAN_STEP_OPTIONS, planPeriodDays } from '@/domain/spending-plan';
import { loadPlanContext } from '@/features/spending-plan/context';
import { suggestPlanTargets, type PlanSuggestionItem } from '@/features/spending-plan/plan-ai';
import { refinePlanAllocation } from '@/features/spending-plan/plan-ai';
import { deletePlan, savePlan, updatePlanTargets } from '@/features/spending-plan/store';
import type { GoalSnapshot } from '@/domain/goal-impact';
import { nextPlanTargets } from '@/domain/goal-review';
import { loadGoalView } from '@/features/goals/loader';
import { addDays, assertDateOnly, todayJst } from '@/lib/date';
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
      /** ジャンルごとの1日あたりの中央値(根拠の表示用)。 */
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
  | { error: null; items: { genreId: string; targetYen: number }[]; summary: string }
  | { error: string };

/**
 * 総額は固定のまま、ジャンルごとの配分をAIと相談して微調整する。実績・必須ラベルは
 * クライアントの値を信用せず、サーバーで期間から集め直す。
 */
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
    if (!Number.isInteger(input.totalYen) || input.totalYen < 0) {
      return { error: '総額は0円以上の整数で入力してください' };
    }

    const context = await loadPlanContext(start, end);
    const byId = new Map(context.genres.map((g) => [g.genreId, g]));
    const items = input.items.flatMap((item) => {
      const genre = byId.get(item.genreId);
      if (genre === undefined || !Number.isInteger(item.targetYen) || item.targetYen < 0) return [];
      return [
        {
          genreId: genre.genreId,
          genreName: genre.genreName,
          currentYen: item.targetYen,
          baselineYen: genre.baselineYen,
          mustPayShare: genre.mustPayShare,
        },
      ];
    });

    const result = await refinePlanAllocation(readAnthropicApiKey(), {
      periodDays: context.periodDays,
      totalYen: input.totalYen,
      items,
      instruction: input.instruction,
    });
    if (!result.ok) return { error: result.message };
    return {
      error: null,
      items: items.map((item) => ({
        genreId: item.genreId,
        targetYen: result.amounts.get(item.genreId) ?? item.currentYen,
      })),
      summary: result.summary,
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

/**
 * 「この結果で次の目標を作る」。終わった目標の実績を反映した次の目標を、同じ長さで
 * 終了日の翌日から始まる期間として保存する(超えたジャンルは中間へ、大きく下回った
 * ジャンルは実績に合わせ、他は継続。domain/goal-review.ts の nextPlanTargets)。
 * 保存後は、目標画面で配分を直せる。
 */
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

/** レシートの確認画面が、保存前の影響(残り予算の変化)を出すための今の目標と実績。 */
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

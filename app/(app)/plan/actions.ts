'use server';

/**
 * 支出目標(/plan)の Server Action(本人発案、ADR-058)。
 * AI提案は本人が「AIに目標案を作ってもらう」を押した時だけ呼ぶ。
 */

import { revalidatePath } from 'next/cache';

import { PLAN_STEP_OPTIONS, planPeriodDays } from '@/domain/spending-plan';
import { loadPlanContext } from '@/features/spending-plan/context';
import { suggestPlanTargets, type PlanSuggestionItem } from '@/features/spending-plan/plan-ai';
import { deletePlan, savePlan } from '@/features/spending-plan/store';
import { assertDateOnly } from '@/lib/date';
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

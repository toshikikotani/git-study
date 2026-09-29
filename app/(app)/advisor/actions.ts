'use server';

/**
 * 目標画面(/advisor)の Server Action(本人発案)。
 *
 * バリデーションは domain/goals.ts の assertX、店(features/goals/store.ts)を
 * 呼ぶだけにする(docs/glossary.md「レイヤーの命名」)。チャットでの目標作成は
 * /assistant(ADR-059)に統合済み。
 */

import { revalidatePath } from 'next/cache';

import { abandonGoal, GoalStoreError, updateGoalProgress } from '@/features/goals/store';

export async function updateGoalProgressAction(
  goalId: string,
  currentAmountYen: number,
): Promise<{ error: string | null }> {
  try {
    await updateGoalProgress(goalId, currentAmountYen);
  } catch (error) {
    return {
      error: error instanceof GoalStoreError ? error.message : '進捗を更新できませんでした。',
    };
  }
  revalidatePath('/advisor');
  return { error: null };
}

export async function abandonGoalAction(goalId: string): Promise<{ error: string | null }> {
  try {
    await abandonGoal(goalId);
  } catch (error) {
    return {
      error: error instanceof GoalStoreError ? error.message : '目標を更新できませんでした。',
    };
  }
  revalidatePath('/advisor');
  return { error: null };
}

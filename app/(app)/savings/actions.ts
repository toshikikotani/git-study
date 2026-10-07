'use server';

/**
 * 貯金画面(/savings)の Server Action(ADR-077)。
 *
 * バリデーションは domain/goals.ts の assertX、店(features/goals/store.ts)を
 * 呼ぶだけにする(docs/glossary.md「レイヤーの命名」)。
 */

import { revalidatePath } from 'next/cache';

import { parseYen } from '@/domain/money';
import { abandonGoal, achieveGoal, createGoal, GoalStoreError } from '@/features/goals/store';
import { AppError } from '@/lib/errors';

export type GoalFormState = { error: string | null };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

function done() {
  revalidatePath('/savings');
  revalidatePath('/');
}

export async function createGoalAction(
  _prev: GoalFormState,
  formData: FormData,
): Promise<GoalFormState> {
  const amountText = String(formData.get('targetAmountYen') ?? '').trim();
  const targetDate = String(formData.get('targetDate') ?? '').trim();
  try {
    await createGoal({
      title: String(formData.get('title') ?? ''),
      targetAmountYen: amountText === '' ? null : parseYen(amountText),
      targetDate: targetDate === '' ? null : targetDate,
      note: null,
    });
  } catch (error) {
    return { error: errorMessage(error, '目標を保存できませんでした。') };
  }
  done();
  return { error: null };
}

export async function achieveGoalAction(goalId: string): Promise<{ error: string | null }> {
  try {
    await achieveGoal(goalId);
  } catch (error) {
    return {
      error: error instanceof GoalStoreError ? error.message : '目標を更新できませんでした。',
    };
  }
  done();
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
  done();
  return { error: null };
}

'use server';

/**
 * 借り換えシナリオの保存・削除の Server Action(M1-4)。
 *
 * 計算は Client Component(refinance-simulation.tsx)側で完結している。
 * ここではその時点の計算結果をそのまま保存するだけで、再計算はしない。
 */

import { revalidatePath } from 'next/cache';

import { assertScenarioName } from '@/domain/scenario';
import { createScenario, deleteScenario, type RepaymentStrategy } from '@/features/scenarios/store';
import type { DateOnly } from '@/lib/date';
import { describeUserError } from '@/lib/errors';

export type ScenarioFormState = {
  error: string | null;
};

export async function saveRefinanceScenarioAction(
  _prev: ScenarioFormState,
  formData: FormData,
): Promise<ScenarioFormState> {
  try {
    const name = assertScenarioName(String(formData.get('name') ?? ''));
    const strategy = String(formData.get('strategy') ?? '') as RepaymentStrategy;
    const monthlyBudgetYen = Number(formData.get('monthlyBudgetYen'));
    const overrideAnnualRate = Number(formData.get('overrideAnnualRate'));
    const monthsToPayoff = Number(formData.get('monthsToPayoff'));
    const payoffOn = String(formData.get('payoffOn') ?? '') as DateOnly;
    const totalInterestYen = Number(formData.get('totalInterestYen'));
    const totalPaidYen = Number(formData.get('totalPaidYen'));

    await createScenario({
      name,
      strategy,
      monthlyBudgetYen,
      overrideAnnualRate,
      monthsToPayoff,
      payoffOn,
      totalInterestYen,
      totalPaidYen,
    });
  } catch (error) {
    return { error: describeUserError(error, 'シナリオを保存できませんでした。') };
  }
  revalidatePath('/debts');
  return { error: null };
}

export async function deleteScenarioAction(id: string): Promise<void> {
  await deleteScenario(id);
  revalidatePath('/debts');
}

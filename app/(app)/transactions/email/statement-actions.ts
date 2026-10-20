'use server';

import { billingPeriodFor } from '@/domain/statement-reconciliation';
import {
  reconcileAccountStatement,
  type ReconciliationResult,
} from '@/features/transactions/reconciliation-store';
import { todayJst, type DateOnly } from '@/lib/date';

export type ReconcileStatementInput = {
  accountId: string;
  accountName: string;
  closingDay: number | null;
  announcedTotalYen: number;
  periodStartOn: DateOnly | null;
  periodEndOn: DateOnly | null;
};

export async function reconcileStatementAction(
  input: ReconcileStatementInput,
): Promise<{ result: ReconciliationResult | null; error: string | null }> {
  const period = billingPeriodFor(
    { periodStartOn: input.periodStartOn, periodEndOn: input.periodEndOn },
    input.closingDay,
    todayJst(),
  );
  if (!period) {
    return {
      result: null,
      error: '対象期間を決められませんでした。口座の締め日を設定するか、期間を入力してください。',
    };
  }

  try {
    const result = await reconcileAccountStatement({
      accountId: input.accountId,
      accountName: input.accountName,
      announcedTotalYen: input.announcedTotalYen,
      period,
    });
    return { result, error: null };
  } catch (error) {
    return { result: null, error: error instanceof Error ? error.message : '突合に失敗しました。' };
  }
}

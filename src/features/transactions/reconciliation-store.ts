/**
 * 請求金額メールとの突合(FR-18, M6-4)のデータアクセス。
 *
 * 判断(期間の決定・差額の算出)は `domain/statement-reconciliation.ts` の
 * 純粋関数に任せ、ここでは「DB から何を読むか」「DB へどう書くか」だけを担う。
 * 差額があれば `features/alerts/store.ts` の `recordAlerts()`(M3-2)を
 * そのまま使い、`alerts` の `(user_id, dedup_key)` 一意制約で同じ期間の
 * 再突合が重複通知を作らないようにする。
 */

import { formatYen } from '@/domain/money';
import { totalSpending, type PeriodTransaction } from '@/domain/payday-period';
import { reconcileTotals, type BillingPeriod } from '@/domain/statement-reconciliation';
import { recordAlerts } from '@/features/alerts/store';
import { createClient } from '@/lib/supabase/server';

export type ReconciliationInput = {
  accountId: string;
  accountName: string;
  announcedTotalYen: number;
  period: BillingPeriod;
};

export type ReconciliationResult = {
  period: BillingPeriod;
  announcedTotalYen: number;
  importedTotalYen: number;
  differenceYen: number;
  hasDiscrepancy: boolean;
};

export class ReconciliationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconciliationStoreError';
  }
}

export async function reconcileAccountStatement(
  input: ReconciliationInput,
): Promise<ReconciliationResult> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from('transactions')
    .select('amount_yen, is_transfer, review_status')
    .eq('account_id', input.accountId)
    .gte('occurred_on', input.period.startOn)
    .lte('occurred_on', input.period.endOn);
  if (error) throw new ReconciliationStoreError(`明細を取得できませんでした: ${error.message}`);

  const transactions: PeriodTransaction[] = rows.map((row) => ({
    accountId: input.accountId,
    categoryId: null,
    amountYen: row.amount_yen,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
  }));
  const importedTotalYen = totalSpending(transactions);

  const outcome = reconcileTotals(input.announcedTotalYen, importedTotalYen);

  if (outcome.hasDiscrepancy) {
    await recordAlerts([
      {
        kind: 'import_needed',
        severity: 'warn',
        title: `${input.accountName}の取り込み漏れの疑い(${input.period.endOn} 締め)`,
        body:
          `お知らせの金額 ${formatYen(input.announcedTotalYen)} に対し、` +
          `取り込み済みの明細合計は ${formatYen(importedTotalYen)}` +
          `(差額 ${formatYen(Math.abs(outcome.differenceYen))}${outcome.differenceYen > 0 ? '不足' : '超過'})。`,
        dedupKey: `import_gap:${input.accountId}:${input.period.endOn}`,
        debtId: null,
        transactionId: null,
      },
    ]);
  }

  return {
    period: input.period,
    announcedTotalYen: input.announcedTotalYen,
    importedTotalYen,
    differenceYen: outcome.differenceYen,
    hasDiscrepancy: outcome.hasDiscrepancy,
  };
}

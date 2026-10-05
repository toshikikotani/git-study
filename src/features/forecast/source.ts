/**
 * 家計簿の明細(LedgerTransaction)を、予測エンジンの入力(ForecastSourceTransaction)にする。
 * 分割した明細は子ごとに展開し、ジャンルの数え方を家計簿・目標と同じにする。
 */

import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import type { LedgerTransaction } from '@/features/spending/ledger-types';

export function toForecastSource(
  transactions: readonly LedgerTransaction[],
): ForecastSourceTransaction[] {
  return transactions.flatMap((t): ForecastSourceTransaction[] => {
    const base = {
      occurredOn: t.occurredOn,
      ...(t.createdOn ? { createdOn: t.createdOn } : {}),
      status: t.status,
      kind: t.kind,
      isTransfer: t.isTransfer,
      reviewStatus: t.reviewStatus,
      needsInput: t.needsInput,
      merchantName: t.label,
      description: t.description,
    };
    if (t.splits.length === 0) {
      return [{ ...base, genreId: t.genreId, genreName: t.genreName, amountYen: t.amountYen }];
    }
    return t.splits.map((s) => ({
      ...base,
      genreId: s.genreId,
      genreName: s.genreName,
      amountYen: s.amountYen,
    }));
  });
}

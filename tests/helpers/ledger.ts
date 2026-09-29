import type { LedgerSplit, LedgerTransaction } from '@/features/spending/ledger-types';

/** テスト用の明細。必要な項目だけ上書きする。 */
export function ledgerTx(o: Partial<LedgerTransaction> & { id: string }): LedgerTransaction {
  return {
    occurredOn: '2026-09-10',
    label: o.id,
    description: o.id,
    memo: null,
    thumbnailUrl: null,
    genreId: 'dining',
    genreName: '外食',
    amountYen: -1000,
    accountId: 'a',
    paymentMethod: 'one_time',
    branchName: null,
    reconcileDiffYen: null,
    mustPay: false,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    status: 'actual',
    kind: 'normal',
    splits: [],
    ...o,
  };
}

export function ledgerSplit(
  o: Partial<LedgerSplit> & { genreId: string | null; amountYen: number },
): LedgerSplit {
  return { id: `s-${o.genreId}-${o.amountYen}`, note: null, genreName: null, ...o };
}

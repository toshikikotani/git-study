/**
 * カテゴリのシート(⑦)に出す、今期の明細(本人「カテゴリを見た時に明細一覧がない」、ADR-138)。
 * 数え方はカテゴリの画面の一覧と同じ(buildCategoryLines):振替・対象外・入力待ち・収入は除き、
 * 分けたレシートはこのカテゴリの分だけ。シートへ渡すので、画面に要る値だけにする。
 */

import type { LedgerTransaction } from '@/features/spending/ledger-types';
import type { DateOnly } from '@/lib/date';
import { buildCategoryLines, keyOfGenreId, type CategoryTx } from './model';

export type CategorySheetLine = {
  id: string;
  occurredOn: DateOnly;
  label: string;
  /** このカテゴリの分(正の数が支出、返金は負)。 */
  spentYen: number;
  /** 分けたレシートのとき、レシート全体の額。 */
  receiptTotalYen: number | null;
  scheduled: boolean;
  refund: boolean;
  /** 押すと開く記録(分けたレシートはレシート全体)。 */
  transaction: LedgerTransaction;
};

/** 実績は新しい順、そのあとに予定(近い順)。 */
export function categorySheetLines(
  transactions: readonly CategoryTx[],
  genreId: string,
  range: { from: DateOnly; to: DateOnly },
  today: DateOnly,
): CategorySheetLine[] {
  const lines = buildCategoryLines(transactions, keyOfGenreId(genreId), range, today).map((l) => ({
    id: l.txId,
    occurredOn: l.occurredOn,
    label: l.label,
    spentYen: -l.amountYen,
    receiptTotalYen: l.receiptTotalYen,
    scheduled: l.status === 'scheduled',
    refund: l.refund,
    transaction: l.tx,
  }));
  const actual = lines
    .filter((l) => !l.scheduled)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  const scheduled = lines
    .filter((l) => l.scheduled)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  return [...actual, ...scheduled];
}

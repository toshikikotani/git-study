/**
 * 明細の複数カテゴリ分割(本人発案)。
 *
 * 1件の明細(例:スーパーのレシートに食費と日用品が混ざる)を複数の
 * カテゴリへ配分できるようにする。ここで守るのは「元の金額と配分の
 * 合計が必ず一致する」ことだけ(家計簿の合計がずれると本人の信頼が崩れる)。
 * 複数行にまたがる合計チェックは DB の CHECK 制約では表現できないため、
 * 書き込み経路(features/transactions/splits-store.ts)は必ずここを通す。
 */

export type TransactionSplitInput = {
  categoryId: string | null;
  amountYen: number;
  note: string | null;
};

export class TransactionSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionSplitError';
  }
}

/**
 * 分割の妥当性を検証する。
 *   - 2件未満は「分割」にならない
 *   - 各行の金額が0円は不可(ck_transaction_splits_amount_nonzero と対応)
 *   - 合計が元の明細の金額(符号込み)と一致すること
 */
export function assertValidSplits(
  splits: readonly TransactionSplitInput[],
  totalAmountYen: number,
): void {
  if (splits.length < 2) {
    throw new TransactionSplitError('分割は2件以上のカテゴリに分けてください');
  }
  if (splits.some((s) => s.amountYen === 0)) {
    throw new TransactionSplitError('金額が0円の行があります');
  }
  const sum = splits.reduce((acc, s) => acc + s.amountYen, 0);
  if (sum !== totalAmountYen) {
    throw new TransactionSplitError(
      `分割額の合計(${sum}円)が明細の金額(${totalAmountYen}円)と一致しません`,
    );
  }
}

/**
 * 明細一覧に分割を反映する。分割がある明細は複数行に展開し、それぞれの
 * categoryId/amountYen を分割側の値に差し替える。分割が無い明細はそのまま
 * 1行として残す。
 *
 * こうして「展開済みの行の配列」を作ってから domain/budget.ts などの
 * 既存の集計関数へ渡すため、分割のために集計ロジック側を変える必要がない
 * (入力を変えるだけで対応する)。
 */
export function expandTransactionsWithSplits<
  T extends { id: string; categoryId: string | null; amountYen: number },
>(
  transactions: readonly T[],
  splitsByTransactionId: ReadonlyMap<
    string,
    readonly { categoryId: string | null; amountYen: number }[]
  >,
): T[] {
  return transactions.flatMap((t) => {
    const splits = splitsByTransactionId.get(t.id);
    if (!splits || splits.length === 0) return [t];
    return splits.map((s) => ({ ...t, categoryId: s.categoryId, amountYen: s.amountYen }));
  });
}

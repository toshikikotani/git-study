/**
 * 確認画面の内容を、保存する形(明細・品目・分割)へ変換する純粋関数。
 *
 * 保存する明細の金額は常に支払額。品目(子)の合計は支払額にちょうど一致する
 * (draft の按分、domain/receipt-reconcile.ts の allocateToPayment)ため、分割は
 * 「子の合計 = 親の金額」を必ず満たす。子のジャンルが未設定なら親を引き継ぐ。
 */

import { effectiveGenreId } from '@/domain/genre';
import { normalizeStoreName } from '@/domain/store-name';
import type { PaymentMethod } from '@/features/import/adapters';
import type { ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import type { ReceiptItemInput } from '@/features/receipts/items-store';
import { buildPreview } from '@/features/transactions/import-pipeline';
import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import type { TransactionSplitInput } from '@/domain/transaction-splits';

export type ReceiptSavePlan = {
  transaction: StoredTransaction;
  items: ReceiptItemInput[];
  /** 品目が2件以上あるときだけ(子の合計 = 支払額)。 */
  splits: TransactionSplitInput[] | null;
  expenseSubtype: string | null;
};

export function buildReceiptSavePlan(input: {
  parsed: ParsedReceiptTransaction;
  accountId: string;
  /** 明細(親)のジャンル。null なら品目の代表ジャンルを使う。 */
  parentGenreId: string | null;
  /** 品目(lineId)ごとのジャンル。未設定(null/無し)は親を引き継ぐ。 */
  genreByLineId: ReadonlyMap<string, string | null>;
  kind: 'normal' | 'special';
  /** 保存に使う一意な参照(保存後の実 id との対応付け)。 */
  sourceRef: string;
}): ReceiptSavePlan {
  const { parsed } = input;
  const store =
    parsed.storeName ?? normalizeStoreName(parsed.description).name ?? parsed.description;
  const branch = parsed.branchName ?? normalizeStoreName(parsed.description).branch;

  const itemGenre = (lineId: string | undefined): string | null =>
    lineId === undefined ? null : (input.genreByLineId.get(lineId) ?? null);

  const provisional = parsed.items.map((item) => ({
    genreId: itemGenre(item.lineId) ?? input.parentGenreId,
    amountYen: item.amountYen,
  }));
  const parentGenreId = input.parentGenreId ?? effectiveGenreId(null, provisional);

  const [base] = buildPreview(
    [
      {
        occurredOn: parsed.occurredOn,
        description: parsed.description,
        amountYen: parsed.amountYen,
        paymentMethod: parsed.paymentMethod as PaymentMethod,
      },
    ],
    input.accountId,
    () => `receipt-${input.sourceRef}`,
    'manual',
  );
  const diff = parsed.reconcile?.status === 'mismatch' ? parsed.reconcile.diffYen : 0;
  const transaction: StoredTransaction = {
    ...base!,
    merchantName: store === '' ? null : store,
    branchName: branch,
    genreId: parentGenreId,
    classifiedBy: parentGenreId === null ? 'unclassified' : 'manual',
    kind: input.kind,
    reconcileDiffYen: diff === 0 ? null : diff,
    fingerprint: fingerprintOf({
      occurredOn: parsed.occurredOn,
      amountYen: parsed.amountYen,
      description: parsed.description,
    }),
    sourceRef: input.sourceRef,
  };

  const items: ReceiptItemInput[] = parsed.items.map((item, i) => ({
    name: item.description,
    amountYen: item.amountYen,
    genreId: provisional[i]!.genreId,
    productType: item.productType,
  }));
  const splits =
    parsed.items.length >= 2
      ? parsed.items.map((item, i) => ({
          genreId: provisional[i]!.genreId,
          amountYen: item.amountYen,
          note: item.description,
        }))
      : null;

  return { transaction, items, splits, expenseSubtype: parsed.expenseSubtype };
}

/**
 * 取り込み経路(CSV / メール貼り付け)で共通の「分類 → プレビュー組み立て」。
 *
 * ── なぜ切り出すか ──────────────────────────────────────────
 * CSV 取り込みとメール貼り付けは、入り口(パーサ)が違うだけで、そこから先
 * ―検知ルールを当てて StoredTransaction を組み立てる―は同じだった。
 * 2箇所に同じロジックがあると、保存の仕方を直すときに片方だけ直して
 * 片方を忘れる事故が起きる(実際に DETECTION_RULES が複製されていた)。
 *
 * 保存(DB への insert)は Server Action の責務(app/(app)/transactions/actions.ts)。
 * ここは純粋関数のみで、DB にもネットワークにも触れない(取り込み画面から
 * ファイル選択のたびに呼ぶプレビュー計算のため)。
 */

import {
  applyRules,
  DEFAULT_DETECTION_RULES,
  type ClassificationRule,
} from '@/features/classification/rules';
import type { PaymentMethod } from '@/features/import/adapters';
import type { DateOnly } from '@/lib/date';
import { fingerprintOf, type StoredTransaction, type TransactionSource } from './types';

/** CSV 行・メール1件など、取り込み元が共通して持つ最小限の形。 */
export type ImportableRow = {
  occurredOn: DateOnly;
  description: string;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
  paymentMethod: PaymentMethod;
};

/**
 * 行を分類し、保存直前のプレビューへ組み立てる。
 * id は呼び出し側の事情(CSV の行番号、貼り付けの連番など)に委ねる。
 *
 * categoryNameById は表示用(画面に「未分類」ではなくカテゴリ名を出すため)。
 * 省略した場合、ルールがカテゴリを設定しても categoryName は null のままになる
 * (categoryId 自体は正しく入るので、保存や以降の判定には影響しない)。
 */
export function buildPreview(
  rows: readonly ImportableRow[],
  accountId: string,
  idFor: (index: number) => string,
  rules: readonly ClassificationRule[] = DEFAULT_DETECTION_RULES,
  categoryNameById: ReadonlyMap<string, string> = new Map(),
  source: TransactionSource = 'csv',
): StoredTransaction[] {
  return rows.map((row, index) =>
    buildPreviewRow(row, accountId, idFor(index), rules, categoryNameById, source),
  );
}

function buildPreviewRow(
  row: ImportableRow,
  accountId: string,
  id: string,
  rules: readonly ClassificationRule[],
  categoryNameById: ReadonlyMap<string, string>,
  source: TransactionSource,
): StoredTransaction {
  const classification = applyRules(
    {
      accountId,
      description: row.description,
      amountYen: row.amountYen,
      paymentMethod: row.paymentMethod,
    },
    rules,
  );

  return {
    id,
    accountId,
    occurredOn: row.occurredOn,
    description: row.description,
    merchantName: classification.merchantName,
    amountYen: row.amountYen,
    paymentMethod: classification.paymentMethod,
    categoryId: classification.categoryId,
    categoryName: classification.categoryId
      ? (categoryNameById.get(classification.categoryId) ?? null)
      : null,
    classifiedBy: classification.categoryId ? 'rule' : 'unclassified',
    confidence: null,
    // 分類が付いていないものは本人の確認へ回す(FR-12)
    reviewStatus: classification.categoryId ? 'auto_ok' : 'pending',
    source,
    fingerprint: fingerprintOf(row),
    batchId: null,
    sourceRef: null,
  };
}

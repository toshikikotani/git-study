/**
 * 取り込み経路(CSV / メール貼り付け)で共通の「検知 → プレビュー組み立て」。
 *
 * ── なぜ切り出すか ──────────────────────────────────────────
 * CSV 取り込みとメール貼り付けは、入り口(パーサ)が違うだけで、そこから先
 * ―検知ルールを当てて StoredTransaction を組み立てる―は同じだった。
 * 2箇所に同じロジックがあると、保存の仕方を直すときに片方だけ直して
 * 片方を忘れる事故が起きる(実際に DETECTION_RULES が複製されていた)。
 *
 * ADR-057により、ここで決まるのは支払方法(FR-21)だけになった。ジャンルの
 * 分類はパターンルールでは決めず、本人がその場で選ぶか(手動)、後から
 * AIジャンル分類(/reports/genres)にまとめて任せるかのどちらかになる
 * (取り込み直後は genre_id=null のまま保存してよい)。
 *
 * 保存(DB への insert)は Server Action の責務(app/(app)/transactions/actions.ts)。
 * ここは純粋関数のみで、DB にもネットワークにも触れない(取り込み画面から
 * ファイル選択のたびに呼ぶプレビュー計算のため)。
 */

import { applyRules, DEFAULT_DETECTION_RULES } from '@/features/classification/rules';
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
 * 行を検知し、保存直前のプレビューへ組み立てる。
 * id は呼び出し側の事情(CSV の行番号、貼り付けの連番など)に委ねる。
 * ジャンルは付けない(ADR-057、本人が選ぶかAIジャンル分類に任せる)。
 */
export function buildPreview(
  rows: readonly ImportableRow[],
  accountId: string,
  idFor: (index: number) => string,
  source: TransactionSource = 'csv',
): StoredTransaction[] {
  return rows.map((row, index) => buildPreviewRow(row, accountId, idFor(index), source));
}

function buildPreviewRow(
  row: ImportableRow,
  accountId: string,
  id: string,
  source: TransactionSource,
): StoredTransaction {
  const classification = applyRules(
    { description: row.description, paymentMethod: row.paymentMethod },
    DEFAULT_DETECTION_RULES,
  );

  return {
    id,
    accountId,
    occurredOn: row.occurredOn,
    description: row.description,
    merchantName: null,
    amountYen: row.amountYen,
    paymentMethod: classification.paymentMethod,
    genreId: null,
    genreName: null,
    classifiedBy: 'unclassified',
    confidence: null,
    // 確認待ちキューは撤廃した(本人発案、ADR-045)。分類が付かなければ
    // 「未分類」のまま明細一覧に残るだけで、本人が気づいたら編集する。
    reviewStatus: 'auto_ok',
    mustPay: false,
    source,
    fingerprint: fingerprintOf(row),
    batchId: null,
    sourceRef: null,
    memo: null,
  };
}

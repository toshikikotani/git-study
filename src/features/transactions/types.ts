/**
 * 明細(transactions)の画面向け型と、DB に触れない純粋関数。
 *
 * store.ts(Supabase 読み書き、`next/headers` に依存)から分離してある。
 * import-pipeline.ts はプレビュー計算のためクライアント側でも読み込まれる
 * ため、そこから store.ts を直接 import すると `next/headers` がクライアント
 * バンドルに引き込まれてビルドエラーになる(T-7 で発見)。
 */

import type { PaymentMethod } from '@/features/import/adapters';
import type { DateOnly } from '@/lib/date';
import type { Database } from '@/lib/supabase/types';

export type TransactionSource = Database['public']['Enums']['transaction_source'];

/** transactions テーブルの1行(画面が必要とする部分)。 */
export type StoredTransaction = {
  id: string;
  accountId: string;
  occurredOn: DateOnly;
  description: string;
  /** 分類後に確定した店名。分類が付くまでは null(ADR-016 の用語表参照)。 */
  merchantName: string | null;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
  paymentMethod: PaymentMethod;
  categoryId: string | null;
  categoryName: string | null;
  /** 誰が分類したか。DB の classified_by に対応。 */
  classifiedBy: 'unclassified' | 'rule' | 'ai' | 'manual';
  /** AI が付けた確信度(0〜1)。classified_by='ai' のときのみ必須(DB制約)。 */
  confidence: number | null;
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
  source: TransactionSource;
  /** 重複排除キー。DB のトリガ(md5)が自動設定するため、ここの値は上書きされる。 */
  fingerprint: string;
  batchId: string | null;
};

export type ImportBatchSummary = {
  batchId: string;
  fileName: string | null;
  importedAt: string;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
};

export type ImportResult = {
  importedCount: number;
  /** 既に同じ明細があったため取り込まなかった件数(fingerprint の一意制約で判定)。 */
  duplicateCount: number;
};

/**
 * 重複排除キーのプレースホルダを作る。
 *
 * 実際の値は DB のトリガ(docs/schema.sql の set_transaction_fingerprint、
 * account_id・occurred_on・amount_yen・description の md5)が insert 時に
 * 必ず上書きする(BEFORE INSERT トリガのため、ここで送る値そのものは
 * 一意性判定に影響しない)。TS の Insert 型が必須にしているため形だけ整える。
 */
export function fingerprintOf(input: {
  occurredOn: DateOnly;
  amountYen: number;
  description: string;
}): string {
  const normalizedDescription = input.description.replace(/[\s　]/g, '').toLowerCase();
  return `${input.occurredOn.replace(/-/g, '')}|${input.amountYen}|${normalizedDescription}`;
}

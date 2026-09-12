/**
 * 明細(transactions)のデータアクセス(T-7)。
 *
 * 以前はブラウザの sessionStorage に保存していた(タブを閉じると消える、
 * サーバー側のジョブからは保存できない、という NFR-06 違反があった)。
 * ここから Supabase の実テーブルへ読み書きする。
 *
 * 命名は docs/glossary.md の「レイヤーの命名」に従う(list/create/update)。
 * カテゴリ名は categories テーブルを別途引いて解決する(M2-6 の
 * listClassificationRules() と同じパターン。embedded select の型推論に
 * 頼らない)。
 */

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export type {
  TransactionSource,
  StoredTransaction,
  ImportBatchSummary,
  ImportResult,
} from './types';
export { fingerprintOf } from './types';

import type {
  StoredTransaction,
  ImportBatchSummary,
  ImportResult,
  TransactionSource,
} from './types';

export class TransactionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionStoreError';
  }
}

type TransactionRow = Database['public']['Tables']['transactions']['Row'];

function fromRow(
  row: TransactionRow,
  categoryNameById: ReadonlyMap<string, string>,
): StoredTransaction {
  return {
    id: row.id,
    accountId: row.account_id,
    occurredOn: row.occurred_on,
    description: row.description,
    merchantName: row.merchant_name,
    amountYen: row.amount_yen,
    paymentMethod: row.payment_method,
    categoryId: row.category_id,
    categoryName: row.category_id ? (categoryNameById.get(row.category_id) ?? null) : null,
    classifiedBy: row.classified_by,
    confidence: row.confidence,
    reviewStatus: row.review_status,
    source: row.source,
    fingerprint: row.fingerprint,
    batchId: row.import_batch_id,
  };
}

/** 明細の一覧。新しい日付が先頭。 */
export async function listTransactions(): Promise<StoredTransaction[]> {
  const supabase = await createClient();
  const [{ data: rows, error: rowsError }, { data: categories, error: categoriesError }] =
    await Promise.all([
      supabase
        .from('transactions')
        .select('*')
        .order('occurred_on', { ascending: false })
        .order('description', { ascending: true }),
      supabase.from('categories').select('id, name'),
    ]);
  if (rowsError)
    throw new TransactionStoreError(`明細を取得できませんでした: ${rowsError.message}`);
  if (categoriesError) {
    throw new TransactionStoreError(`カテゴリを取得できませんでした: ${categoriesError.message}`);
  }

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  return rows.map((row) => fromRow(row, categoryNameById));
}

export async function listImportBatches(): Promise<ImportBatchSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('import_batches')
    .select('*')
    .order('created_at', { ascending: false });
  if (error)
    throw new TransactionStoreError(`取り込み履歴を取得できませんでした: ${error.message}`);

  return data.map((row) => ({
    batchId: row.id,
    fileName: row.file_name,
    importedAt: row.created_at,
    importedCount: row.imported_count,
    duplicateCount: row.duplicate_count,
    failedCount: row.failed_count,
  }));
}

/**
 * 明細を取り込む(ADR-007 の冪等性:fingerprint が既存と重なるものは
 * 取り込まない)。`import_batches` に1行作り、`transactions` を
 * `upsert(..., ignoreDuplicates: true)` で挿入する(M3-2 の recordAlerts() と
 * 同じ、DB の一意制約を「既に取り込み済みか」の判定に使うパターン)。
 */
export async function importTransactions(
  transactions: readonly StoredTransaction[],
  meta: {
    fileName: string | null;
    source: TransactionSource;
    accountId: string;
    failedCount: number;
  },
): Promise<ImportResult> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new TransactionStoreError('ログイン状態を確認できませんでした');
  }

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      user_id: auth.user.id,
      source: meta.source,
      account_id: meta.accountId,
      file_name: meta.fileName,
      row_count: transactions.length,
      failed_count: meta.failedCount,
      status: 'pending',
    })
    .select('id')
    .single();
  if (batchError) {
    throw new TransactionStoreError(`取り込みを開始できませんでした: ${batchError.message}`);
  }

  if (transactions.length === 0) {
    await supabase
      .from('import_batches')
      .update({
        imported_count: 0,
        duplicate_count: 0,
        status: 'succeeded',
        completed_at: new Date().toISOString(),
      })
      .eq('id', batch.id);
    return { importedCount: 0, duplicateCount: 0 };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('transactions')
    .upsert(
      transactions.map((t) => ({
        user_id: auth.user.id,
        account_id: meta.accountId,
        occurred_on: t.occurredOn,
        description: t.description,
        merchant_name: t.merchantName,
        amount_yen: t.amountYen,
        payment_method: t.paymentMethod,
        category_id: t.categoryId,
        classified_by: t.classifiedBy,
        confidence: t.confidence,
        review_status: t.reviewStatus,
        source: meta.source,
        import_batch_id: batch.id,
        fingerprint: t.fingerprint,
      })),
      { onConflict: 'user_id,fingerprint', ignoreDuplicates: true },
    )
    .select('id');

  if (insertError) {
    await supabase
      .from('import_batches')
      .update({
        status: 'failed',
        error_message: insertError.message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', batch.id);
    throw new TransactionStoreError(`明細を保存できませんでした: ${insertError.message}`);
  }

  const importedCount = inserted.length;
  const duplicateCount = transactions.length - importedCount;

  await supabase
    .from('import_batches')
    .update({
      imported_count: importedCount,
      duplicate_count: duplicateCount,
      status: 'succeeded',
      completed_at: new Date().toISOString(),
    })
    .eq('id', batch.id);

  return { importedCount, duplicateCount };
}

/**
 * 確認待ちキューでの1件修正(M2-5)。分類の確定は常にこの形(本人が選んだ
 * categoryId、classified_by='manual'、review_status='corrected')なので、
 * 汎用の補正オブジェクトではなく categoryId だけを受け取る。
 */
export async function updateTransaction(id: string, categoryId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('transactions')
    .update({
      category_id: categoryId,
      classified_by: 'manual',
      review_status: 'corrected',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new TransactionStoreError(`明細を更新できませんでした: ${error.message}`);
}

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

import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '@/lib/errors';
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

export class TransactionStoreError extends AppError {}

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
    matchedRuleId: row.matched_rule_id,
    classifiedBy: row.classified_by,
    confidence: row.confidence,
    reviewStatus: row.review_status,
    source: row.source,
    fingerprint: row.fingerprint,
    batchId: row.import_batch_id,
    sourceRef: row.source_ref,
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
    /**
     * レシート撮影(本人発案)。1回の撮影=1バッチのため、この行に置く
     * (features/import/receipt-storage.ts 参照)。他の取り込み経路では省略する。
     */
    receiptImagePath?: string | null;
  },
): Promise<ImportResult> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new TransactionStoreError('ログイン状態を確認できませんでした');
  }
  return importTransactionsAsAdmin(supabase, auth.user.id, transactions, meta);
}

/**
 * 本人のセッション(cookie)が無い経路(LINE の受信 Webhook、Gmail 自動取り込み
 * 相当)向け。管理クライアント + 明示的な user_id で書く
 * (`app/api/cron/keepalive/route.ts` と同じ考え方)。ロジック本体はここに
 * 集約し、`importTransactions()` は本人のセッションから user_id を取り出す
 * だけの薄いラッパーにする(2箇所に同じ取り込みロジックを持たない)。
 */
export async function importTransactionsAsAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
  transactions: readonly StoredTransaction[],
  meta: {
    fileName: string | null;
    source: TransactionSource;
    accountId: string;
    failedCount: number;
    receiptImagePath?: string | null;
  },
): Promise<ImportResult> {
  const batchBase = {
    user_id: userId,
    source: meta.source,
    account_id: meta.accountId,
    file_name: meta.fileName,
    row_count: transactions.length,
    failed_count: meta.failedCount,
    status: 'pending' as const,
  };

  // receipt_image_path は B-8(マイグレーション未適用)の間、本番に列自体が
  // 無い。列の有無で処理を分けるのではなく「無ければ諦めて普通に insert し
  // 直す」ことで、レシート機能以外(CSV・メール)は最初から気にせず動き、
  // レシートも画像パスが保存されないだけで取り込み自体は失敗しない
  // (splits-store.ts の isMissingTableError と同じ考え方。列版)。
  let result: {
    data: { id: string } | null;
    error: { message: string; code?: string } | null;
  } | null = null;
  if (meta.receiptImagePath !== undefined) {
    const attempt = await supabase
      .from('import_batches')
      .insert({ ...batchBase, receipt_image_path: meta.receiptImagePath })
      .select('id')
      .single();
    // 実際の本番 Supabase で確認した値:INSERT では PGRST204(PostgREST の
    // スキーマキャッシュ層)、SELECT では 42703(Postgres 本来のエラー)を
    // 返すことがある。どちらも「列が無い」ことを意味するため両方見る。
    if (attempt.error?.code !== '42703' && attempt.error?.code !== 'PGRST204') result = attempt;
  }
  result ??= await supabase.from('import_batches').insert(batchBase).select('id').single();

  const { data: batch, error: batchError } = result;
  if (batchError || !batch) {
    throw new TransactionStoreError(`取り込みを開始できませんでした: ${batchError?.message}`);
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
    return { importedCount: 0, duplicateCount: 0, insertedTransactions: [] };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('transactions')
    .upsert(
      transactions.map((t) => ({
        user_id: userId,
        account_id: meta.accountId,
        occurred_on: t.occurredOn,
        description: t.description,
        merchant_name: t.merchantName,
        amount_yen: t.amountYen,
        payment_method: t.paymentMethod,
        category_id: t.categoryId,
        matched_rule_id: t.matchedRuleId,
        classified_by: t.classifiedBy,
        confidence: t.confidence,
        review_status: t.reviewStatus,
        source: meta.source,
        import_batch_id: batch.id,
        fingerprint: t.fingerprint,
        source_ref: t.sourceRef,
      })),
      { onConflict: 'user_id,fingerprint', ignoreDuplicates: true },
    )
    // fingerprint はトリガが上書きする値なので、渡した行との対応付けには使えない
    // (types.ts の fingerprintOf() のコメント参照)。source_ref はトリガが
    // 触らずそのまま入るため、こちらで対応付ける(レシート商品行の自動分割、
    // 本人発案)。
    .select('id, source_ref');

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

  return {
    importedCount,
    duplicateCount,
    insertedTransactions: inserted.map((row) => ({ id: row.id, sourceRef: row.source_ref })),
  };
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

/**
 * 1件を集計対象から外す(重複の片側を消すときに使う、本人発案)。
 *
 * 行は消さない。同じ買い物が複数経路から入っていた事実そのものは
 * 残しておきたい(消すと、次の取り込みでまた入ってきたときに
 * 「前にも同じことがあった」が分からなくなる)。ignored は
 * domain/budget.ts の isCountable() が全機能で除外するため、
 * 予算・レポート・ちりつも・アラートから一斉に消える。
 */
export async function ignoreTransaction(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('transactions')
    .update({
      review_status: 'ignored',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new TransactionStoreError(`明細を除外できませんでした: ${error.message}`);
}

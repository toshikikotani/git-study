/**
 * 同じ支払いを1件にまとめる・分ける(v4 の共通の土台1、ADR-129)。どれをまとめるかは
 * domain/payment-merge.ts。ここは読み書きだけ。
 *
 * まとめるとき:支払いの知らせ(カードの通知メール)の方を残し、レシートの品目・分割・画像をそこへ移す。
 * レシートの方は「数えない」(ignored)にして集計から外す(消さない)。移す前の状態を payment_merges に
 * 残し、「分ける」で元に戻す。画像は取り込み単位(import_batches.receipt_image_path)に付いているので、
 * 残す方の取り込み単位をレシートの方に付け替える。
 *
 * アプリ(本人のセッション)と、Gmail・LINE の取り込み(管理クライアント + 明示的な user_id)の両方から
 * 使うので、どれも user_id で絞る。テーブルが無い(マイグレーション未適用)ときは何もしない。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { findMergePairs, mergedNoteText, type MergeCandidate } from '@/domain/payment-merge';
import type { DateOnly } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import type { Database, Json } from '@/lib/supabase/types';

type Client = SupabaseClient<Database>;

export class PaymentMergeError extends AppError {}

type Row = {
  id: string;
  occurred_on: string;
  amount_yen: number;
  merchant_name: string | null;
  description: string;
  source: string;
  import_batch_id: string | null;
  genre_id: string | null;
  classified_by: Database['public']['Enums']['classified_by'];
  review_status: Database['public']['Enums']['review_status'];
};

const toCandidate = (r: Row): MergeCandidate => ({
  id: r.id,
  occurredOn: r.occurred_on,
  amountYen: r.amount_yen,
  merchantName: r.merchant_name,
  description: r.description,
});

/** 指定した日の、まとめられる組をまとめる。まとめた件数を返す。 */
export async function autoMergeSamePayments(
  client: Client,
  userId: string,
  dates: readonly DateOnly[],
): Promise<number> {
  const days = [...new Set(dates)];
  if (days.length === 0) return 0;

  const existing = await client
    .from('payment_merges')
    .select('kept_transaction_id, merged_transaction_id')
    .eq('user_id', userId);
  if (existing.error) {
    if (isMissingTableError(existing.error)) return 0;
    throw new PaymentMergeError(`まとめの記録を読めませんでした: ${existing.error.message}`);
  }
  const taken = new Set(
    existing.data.flatMap((m) => [m.kept_transaction_id, m.merged_transaction_id]),
  );

  const { data, error } = await client
    .from('transactions')
    .select(
      'id, occurred_on, amount_yen, merchant_name, description, source, import_batch_id, genre_id, classified_by, review_status',
    )
    .eq('user_id', userId)
    .in('occurred_on', days)
    .neq('review_status', 'ignored')
    .eq('is_transfer', false)
    .lt('amount_yen', 0);
  if (error) throw new PaymentMergeError(`明細を読めませんでした: ${error.message}`);
  const rows = (data ?? []).filter((r) => !taken.has(r.id)) as Row[];
  const payments = rows.filter((r) => r.source === 'gmail');
  const manual = rows.filter((r) => r.source === 'manual');
  if (payments.length === 0 || manual.length === 0) return 0;

  // レシート = 品目があるか、画像のある取り込み単位に入っている記録。
  const [items, batches] = await Promise.all([
    client
      .from('receipt_items')
      .select('transaction_id')
      .eq('user_id', userId)
      .in(
        'transaction_id',
        manual.map((r) => r.id),
      ),
    client
      .from('import_batches')
      .select('id, receipt_image_path')
      .eq('user_id', userId)
      .in(
        'id',
        manual.flatMap((r) => (r.import_batch_id ? [r.import_batch_id] : [])),
      ),
  ]);
  const withItems = new Set((items.data ?? []).map((i) => i.transaction_id));
  const withImage = new Set(
    (batches.data ?? []).flatMap((b) => (b.receipt_image_path ? [b.id] : [])),
  );
  const receipts = manual.filter(
    (r) => withItems.has(r.id) || (r.import_batch_id !== null && withImage.has(r.import_batch_id)),
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  let merged = 0;
  for (const pair of findMergePairs(payments.map(toCandidate), receipts.map(toCandidate))) {
    const payment = byId.get(pair.payment.id)!;
    const receipt = byId.get(pair.receipt.id)!;
    await mergePair(client, userId, payment, receipt, withImage);
    merged += 1;
  }
  return merged;
}

/**
 * 本人が「1件にまとめる」を選んだとき(レシートの確認の「同じ支払いかも」、ADR-133)。保存したレシートを、
 * 選んだ記録(支払いの知らせなど)にまとめる。どちらかがもうまとめてあれば何もしない(false)。
 */
export async function mergeReceiptIntoPayment(
  client: Client,
  userId: string,
  receiptId: string,
  paymentId: string,
): Promise<boolean> {
  if (receiptId === paymentId) return false;
  const existing = await client
    .from('payment_merges')
    .select('kept_transaction_id, merged_transaction_id')
    .eq('user_id', userId);
  if (existing.error) {
    if (isMissingTableError(existing.error)) return false;
    throw new PaymentMergeError(`まとめの記録を読めませんでした: ${existing.error.message}`);
  }
  const taken = new Set(
    existing.data.flatMap((m) => [m.kept_transaction_id, m.merged_transaction_id]),
  );
  if (taken.has(receiptId) || taken.has(paymentId)) return false;

  const { data, error } = await client
    .from('transactions')
    .select(
      'id, occurred_on, amount_yen, merchant_name, description, source, import_batch_id, genre_id, classified_by, review_status',
    )
    .eq('user_id', userId)
    .in('id', [receiptId, paymentId]);
  if (error) throw new PaymentMergeError(`明細を読めませんでした: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const receipt = rows.find((r) => r.id === receiptId);
  const payment = rows.find((r) => r.id === paymentId);
  if (!receipt || !payment) return false;

  let withImage = new Set<string>();
  if (receipt.import_batch_id !== null) {
    const { data: batch } = await client
      .from('import_batches')
      .select('id, receipt_image_path')
      .eq('user_id', userId)
      .eq('id', receipt.import_batch_id)
      .maybeSingle();
    if (batch?.receipt_image_path) withImage = new Set([batch.id]);
  }
  await mergePair(client, userId, payment, receipt, withImage);
  return true;
}

/** まとめた側(レシート)の id から、残した側の id を引く(保存の取り消しで「分ける」ため)。 */
export async function keptIdsOfMerged(
  client: Client,
  userId: string,
  mergedIds: readonly string[],
): Promise<string[]> {
  if (mergedIds.length === 0) return [];
  const { data, error } = await client
    .from('payment_merges')
    .select('kept_transaction_id')
    .eq('user_id', userId)
    .in('merged_transaction_id', [...mergedIds]);
  if (error) return [];
  return (data ?? []).map((m) => m.kept_transaction_id);
}

async function mergePair(
  client: Client,
  userId: string,
  payment: Row,
  receipt: Row,
  withImage: ReadonlySet<string>,
): Promise<void> {
  const [items, receiptSplits, paymentSplits] = await Promise.all([
    client
      .from('receipt_items')
      .select('id')
      .eq('user_id', userId)
      .eq('transaction_id', receipt.id),
    client
      .from('transaction_splits')
      .select('id')
      .eq('user_id', userId)
      .eq('transaction_id', receipt.id),
    client
      .from('transaction_splits')
      .select('id')
      .eq('user_id', userId)
      .eq('transaction_id', payment.id),
  ]);
  const itemIds = (items.data ?? []).map((i) => i.id);
  // 支払いの方にもう分割があれば、レシートの分割は移さない(二重に分けない)。
  const splitIds =
    (paymentSplits.data ?? []).length > 0 ? [] : (receiptSplits.data ?? []).map((s) => s.id);
  const moveImage = receipt.import_batch_id !== null && withImage.has(receipt.import_batch_id);

  const { error: recordError } = await client.from('payment_merges').insert({
    user_id: userId,
    kept_transaction_id: payment.id,
    merged_transaction_id: receipt.id,
    kept_before: {
      import_batch_id: payment.import_batch_id,
      genre_id: payment.genre_id,
      classified_by: payment.classified_by,
    } satisfies Json,
    merged_before: { review_status: receipt.review_status } satisfies Json,
    moved_item_ids: itemIds,
    moved_split_ids: splitIds,
  });
  if (recordError)
    throw new PaymentMergeError(`まとめを保存できませんでした: ${recordError.message}`);

  if (itemIds.length > 0) {
    await client
      .from('receipt_items')
      .update({ transaction_id: payment.id })
      .eq('user_id', userId)
      .in('id', itemIds);
  }
  if (splitIds.length > 0) {
    await client
      .from('transaction_splits')
      .update({ transaction_id: payment.id })
      .eq('user_id', userId)
      .in('id', splitIds);
  }
  await client
    .from('transactions')
    .update({
      ...(moveImage ? { import_batch_id: receipt.import_batch_id } : {}),
      // レシートで選んだカテゴリの方が確か(品目を見て選んでいる)。
      ...(receipt.genre_id !== null
        ? { genre_id: receipt.genre_id, classified_by: receipt.classified_by }
        : {}),
    })
    .eq('user_id', userId)
    .eq('id', payment.id);
  await client
    .from('transactions')
    .update({ review_status: 'ignored', reviewed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', receipt.id);
}

type KeptBefore = { import_batch_id?: unknown; genre_id?: unknown; classified_by?: unknown };
const CLASSIFIED_BY = new Set(['unclassified', 'rule', 'ai', 'manual']);
const REVIEW = new Set(['auto_ok', 'pending', 'confirmed', 'corrected']);

/** 「分ける」:まとめる前に戻す(品目・分割・画像をレシートへ戻し、レシートを数える状態に戻す)。 */
export async function splitMergedPayment(
  client: Client,
  userId: string,
  keptTransactionId: string,
): Promise<void> {
  const { data: merge, error } = await client
    .from('payment_merges')
    .select('*')
    .eq('user_id', userId)
    .eq('kept_transaction_id', keptTransactionId)
    .maybeSingle();
  if (error || !merge) throw new PaymentMergeError('まとめた記録が見つかりませんでした。');

  const kept = (merge.kept_before ?? {}) as KeptBefore;
  const mergedBefore = (merge.merged_before ?? {}) as { review_status?: unknown };
  if (merge.moved_item_ids.length > 0) {
    await client
      .from('receipt_items')
      .update({ transaction_id: merge.merged_transaction_id })
      .eq('user_id', userId)
      .in('id', merge.moved_item_ids);
  }
  if (merge.moved_split_ids.length > 0) {
    await client
      .from('transaction_splits')
      .update({ transaction_id: merge.merged_transaction_id })
      .eq('user_id', userId)
      .in('id', merge.moved_split_ids);
  }
  await client
    .from('transactions')
    .update({
      import_batch_id: typeof kept.import_batch_id === 'string' ? kept.import_batch_id : null,
      genre_id: typeof kept.genre_id === 'string' ? kept.genre_id : null,
      classified_by:
        typeof kept.classified_by === 'string' && CLASSIFIED_BY.has(kept.classified_by)
          ? (kept.classified_by as Row['classified_by'])
          : 'unclassified',
    })
    .eq('user_id', userId)
    .eq('id', keptTransactionId);
  await client
    .from('transactions')
    .update({
      review_status:
        typeof mergedBefore.review_status === 'string' && REVIEW.has(mergedBefore.review_status)
          ? (mergedBefore.review_status as Row['review_status'])
          : 'auto_ok',
      reviewed_at: null,
    })
    .eq('user_id', userId)
    .eq('id', merge.merged_transaction_id);
  await client
    .from('payment_merges')
    .delete()
    .eq('user_id', userId)
    .eq('merged_transaction_id', merge.merged_transaction_id);
}

/** 残した方の記録に添える「1件にまとめました」の説明(id → 説明)。 */
export async function loadMergedNotes(
  client: Client,
  userId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await client
    .from('payment_merges')
    .select('kept_transaction_id, merged_transaction_id')
    .eq('user_id', userId)
    .in('kept_transaction_id', [...ids]);
  if (error || !data || data.length === 0) return new Map();
  const { data: rows } = await client
    .from('transactions')
    .select('id, amount_yen')
    .eq('user_id', userId)
    .in(
      'id',
      data.map((m) => m.kept_transaction_id),
    );
  const amountById = new Map((rows ?? []).map((r) => [r.id, r.amount_yen]));
  return new Map(
    data.map((m) => [
      m.kept_transaction_id,
      mergedNoteText(amountById.get(m.kept_transaction_id) ?? 0),
    ]),
  );
}

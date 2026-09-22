/**
 * 重複候補(複数経路から入った同じ買い物)のデータアクセス(本人発案)。
 *
 * 判定は domain/duplicate-match.ts の純粋関数に任せ、ここでは
 * 「どの範囲を読むか」と「画面に出すための口座名の解決」だけを担う。
 * 新しいテーブルは持たない(除外の記録は既存の review_status='ignored')。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { findDuplicateCandidates, type MatchableTransaction } from '@/domain/duplicate-match';
import { createReceiptImageSignedUrl } from '@/features/import/receipt-storage';
import { addDays, todayJst, type DateOnly } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

import type { TransactionSource } from './types';

export class DuplicateStoreError extends AppError {}

/**
 * 遡る日数。取り込みは月次(CSV)と日次(メール・レシート)が混ざるため、
 * 月をまたいだ取り込みでも拾えるだけの幅を取る。
 */
const LOOKBACK_DAYS = 90;

export type DuplicateSideView = {
  id: string;
  occurredOn: DateOnly;
  label: string;
  /** 正の数(支出額)。 */
  amountYen: number;
  source: TransactionSource;
  accountName: string;
  /**
   * レシート撮影から入った側だけ持つ(本人発案)。同じ買い物か本人が見比べて
   * 判断できるように、確認画面から元の写真を開けるようにする。バケット・
   * マイグレーション未適用や署名URLの発行失敗時は静かに null(重複確認
   * そのものは画像が無くても成立するため)。
   */
  receiptImageUrl: string | null;
};

export type DuplicateCandidateView = {
  earlier: DuplicateSideView;
  later: DuplicateSideView;
  dayGap: number;
};

type Row = MatchableTransaction & {
  label: string;
  accountId: string;
  batchId: string | null;
};

export async function listDuplicateCandidates(
  now: Date = new Date(),
): Promise<DuplicateCandidateView[]> {
  const rangeStart = addDays(todayJst(now), -LOOKBACK_DAYS);

  const supabase = await createClient();
  const [{ data: rows, error }, { data: accounts, error: accountsError }] = await Promise.all([
    supabase
      .from('transactions')
      .select(
        'id, account_id, occurred_on, amount_yen, merchant_name, description, source, is_transfer, review_status, category_id, import_batch_id',
      )
      .gte('occurred_on', rangeStart),
    supabase.from('accounts').select('id, name'),
  ]);
  if (error) throw new DuplicateStoreError(`明細を取得できませんでした: ${error.message}`);
  if (accountsError) {
    throw new DuplicateStoreError(`口座を取得できませんでした: ${accountsError.message}`);
  }

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const transactions: Row[] = rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    occurredOn: row.occurred_on,
    amountYen: row.amount_yen,
    categoryId: row.category_id,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
    source: row.source,
    label: row.merchant_name ?? row.description,
    batchId: row.import_batch_id,
  }));

  const candidates = findDuplicateCandidates(transactions);
  if (candidates.length === 0) return [];

  const batchIds = new Set<string>();
  for (const c of candidates) {
    if (c.earlier.batchId) batchIds.add(c.earlier.batchId);
    if (c.later.batchId) batchIds.add(c.later.batchId);
  }
  const imageUrlByBatchId = await loadReceiptImageUrls(supabase, [...batchIds]);

  return candidates.map((candidate) => ({
    earlier: toSideView(candidate.earlier, accountNameById, imageUrlByBatchId),
    later: toSideView(candidate.later, accountNameById, imageUrlByBatchId),
    dayGap: candidate.dayGap,
  }));
}

function toSideView(
  row: Row,
  accountNameById: ReadonlyMap<string, string>,
  imageUrlByBatchId: ReadonlyMap<string, string>,
): DuplicateSideView {
  return {
    id: row.id,
    occurredOn: row.occurredOn,
    label: row.label,
    amountYen: -row.amountYen,
    source: row.source,
    accountName: accountNameById.get(row.accountId) ?? '不明な口座',
    receiptImageUrl: row.batchId ? (imageUrlByBatchId.get(row.batchId) ?? null) : null,
  };
}

/**
 * レシート撮影の候補だけ、元の写真を開けるようにする(本人発案)。
 *
 * import_batches.receipt_image_path はマイグレーション未適用(B-8)の間
 * 列自体が無いため、この問い合わせは失敗しうる。失敗しても重複確認は
 * 画像なしで成立するため、例外にせず空の Map を返す。
 */
async function loadReceiptImageUrls(
  supabase: SupabaseClient<Database>,
  batchIds: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (batchIds.length === 0) return map;

  const { data, error } = await supabase
    .from('import_batches')
    .select('id, receipt_image_path')
    .in('id', batchIds)
    .not('receipt_image_path', 'is', null);
  if (error || !data) return map;

  await Promise.all(
    data.map(async (row) => {
      if (!row.receipt_image_path) return;
      const url = await createReceiptImageSignedUrl(supabase, row.receipt_image_path);
      if (url) map.set(row.id, url);
    }),
  );
  return map;
}

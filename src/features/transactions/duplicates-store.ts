/**
 * 重複候補(複数経路から入った同じ買い物)のデータアクセス(本人発案)。
 *
 * 判定は domain/duplicate-match.ts の純粋関数に任せ、ここでは
 * 「どの範囲を読むか」と「画面に出すための口座名の解決」だけを担う。
 * 片側の除外は review_status='ignored'、両方を残す判断はペア単位で保存する。
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import {
  duplicatePairKey,
  duplicatePairSignature,
  iterateDuplicatePairs,
  findDuplicateCandidates,
  type DuplicateCandidate,
  type MatchableTransaction,
} from '@/domain/duplicate-match';
import { createReceiptImageSignedUrl } from '@/features/import/receipt-storage';
import { addDays, todayJst, type DateOnly } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { isMissingTableError } from '@/lib/supabase/errors';
import type { Database } from '@/lib/supabase/types';

import {
  duplicateDecisionDigest,
  readBrowserDuplicateDecisions,
  writeBrowserDuplicateDecision,
} from './duplicate-decisions-cookie';

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
  key: string;
  signature: string;
  earlier: DuplicateSideView;
  later: DuplicateSideView;
  dayGap: number;
};

export type DuplicateReviewView = {
  candidates: DuplicateCandidateView[];
  decided: DuplicateCandidateView[];
  storage: 'account' | 'browser';
  hasBrowserDecisions: boolean;
};

type Row = MatchableTransaction & {
  label: string;
  accountId: string;
  batchId: string | null;
};

export async function listDuplicateCandidates(
  now: Date = new Date(),
): Promise<DuplicateCandidateView[]> {
  return (await listDuplicateReview(now)).candidates;
}

export async function listDuplicateReview(now: Date = new Date()): Promise<DuplicateReviewView> {
  const rangeStart = addDays(todayJst(now), -LOOKBACK_DAYS);

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user)
    throw new DuplicateStoreError('ログイン状態を確認できませんでした。');
  const userId = auth.user.id;
  const [{ data: rows, error }, { data: accounts, error: accountsError }, stored, browser] =
    await Promise.all([
      supabase
        .from('transactions')
        .select(
          'id, account_id, occurred_on, amount_yen, merchant_name, description, source, is_transfer, review_status, genre_id, import_batch_id',
        )
        .eq('user_id', userId)
        .gte('occurred_on', rangeStart),
      supabase.from('accounts').select('id, name'),
      readDecisionSignatures(supabase, userId),
      readBrowserDuplicateDecisions(userId),
    ]);
  if (error) throw new DuplicateStoreError(`明細を取得できませんでした: ${error.message}`);
  if (accountsError) {
    throw new DuplicateStoreError(`口座を取得できませんでした: ${accountsError.message}`);
  }
  if (stored.error && !isMissingTableError(stored.error)) {
    throw new DuplicateStoreError(`確認結果を取得できませんでした: ${stored.error.message}`);
  }

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const transactions: Row[] = rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    occurredOn: row.occurred_on,
    amountYen: row.amount_yen,
    categoryId: row.genre_id,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
    source: row.source,
    label: row.merchant_name ?? row.description,
    batchId: row.import_batch_id,
  }));

  const distinctSignatures = new Set(stored.data?.map((item) => item.signature) ?? []);
  const browserDigests = new Set(browser.map((item) => item.digest));
  // cookieは認可情報ではない。本人が読める現在の候補だけと照合して採用する。
  const decided: DuplicateCandidate<Row>[] = [];
  for (const pair of iterateDuplicatePairs(transactions)) {
    const signature = duplicatePairSignature(pair.earlier, pair.later);
    if (browserDigests.has(duplicateDecisionDigest(signature))) distinctSignatures.add(signature);
    if (distinctSignatures.has(signature)) decided.push(pair);
  }
  const candidates = findDuplicateCandidates(transactions, {
    distinctPairSignatures: distinctSignatures,
  });
  decided.reverse();

  const batchIds = new Set<string>();
  for (const c of [...candidates, ...decided]) {
    if (c.earlier.batchId) batchIds.add(c.earlier.batchId);
    if (c.later.batchId) batchIds.add(c.later.batchId);
  }
  const imageUrlByBatchId = await loadReceiptImageUrls(supabase, [...batchIds]);

  const toView = (candidate: DuplicateCandidate<Row>): DuplicateCandidateView => ({
    key: duplicatePairKey(candidate.earlier, candidate.later),
    signature: duplicatePairSignature(candidate.earlier, candidate.later),
    earlier: toSideView(candidate.earlier, accountNameById, imageUrlByBatchId),
    later: toSideView(candidate.later, accountNameById, imageUrlByBatchId),
    dayGap: candidate.dayGap,
  });
  return {
    candidates: candidates.map(toView),
    decided: decided.map(toView),
    storage: stored.error ? 'browser' : 'account',
    hasBrowserDecisions: browser.length > 0,
  };
}

/** PostgRESTの1,000行上限で、保存済みの古い判断を取りこぼさない。 */
async function readDecisionSignatures(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ data: { signature: string }[]; error: PostgrestError | null }> {
  const signatures: { signature: string }[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('duplicate_pair_decisions')
      .select('signature')
      .eq('user_id', userId)
      .order('transaction_a_id')
      .order('transaction_b_id')
      .range(offset, offset + pageSize - 1);
    if (error) return { data: [], error };
    signatures.push(...data);
    if (data.length < pageSize) return { data: signatures, error: null };
  }
}

/** 画面表示後の編集や別ユーザーのIDを受け付けず、本人の現状から再検証する。 */
async function validatedPair(aId: string, bId: string, expectedSignature: string) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuid.test(aId) || !uuid.test(bId) || aId === bId || expectedSignature.length > 500) {
    throw new DuplicateStoreError('確認する明細を選び直してください。');
  }
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user)
    throw new DuplicateStoreError('ログイン状態を確認できませんでした。');
  const { data, error } = await supabase
    .from('transactions')
    .select('id, occurred_on, amount_yen, source, is_transfer, review_status, genre_id')
    .eq('user_id', auth.user.id)
    .in('id', [aId, bId]);
  if (error) throw new DuplicateStoreError(`明細を確認できませんでした: ${error.message}`);
  const pair = findDuplicateCandidates(
    (data ?? []).map((row) => ({
      id: row.id,
      occurredOn: row.occurred_on,
      amountYen: row.amount_yen,
      source: row.source,
      isTransfer: row.is_transfer,
      reviewStatus: row.review_status,
      categoryId: row.genre_id,
    })),
  )[0];
  if (!pair || duplicatePairSignature(pair.earlier, pair.later) !== expectedSignature) {
    throw new DuplicateStoreError('明細が変更されています。画面を開き直して確認してください。');
  }
  const [transactionAId, transactionBId] = [aId, bId].sort();
  return {
    supabase,
    userId: auth.user.id,
    transactionAId: transactionAId!,
    transactionBId: transactionBId!,
  };
}

export async function saveDistinctPair(aId: string, bId: string, signature: string): Promise<void> {
  const { supabase, userId, transactionAId, transactionBId } = await validatedPair(
    aId,
    bId,
    signature,
  );
  const { error } = await supabase.from('duplicate_pair_decisions').upsert({
    user_id: userId,
    transaction_a_id: transactionAId,
    transaction_b_id: transactionBId,
    signature,
    decided_at: new Date().toISOString(),
  });
  if (error) {
    if (!isMissingTableError(error))
      throw new DuplicateStoreError(`確認結果を保存できませんでした: ${error.message}`);
    try {
      await writeBrowserDuplicateDecision(userId, signature);
    } catch (cookieError) {
      throw new DuplicateStoreError(
        cookieError instanceof Error
          ? cookieError.message
          : 'このブラウザに確認結果を保存できませんでした。',
      );
    }
  }
}

export async function undoDistinctPair(aId: string, bId: string, signature: string): Promise<void> {
  const { supabase, userId, transactionAId, transactionBId } = await validatedPair(
    aId,
    bId,
    signature,
  );
  const { error } = await supabase
    .from('duplicate_pair_decisions')
    .delete()
    .eq('user_id', userId)
    .eq('transaction_a_id', transactionAId)
    .eq('transaction_b_id', transactionBId);
  if (error && !isMissingTableError(error)) {
    throw new DuplicateStoreError(`確認結果を戻せませんでした: ${error.message}`);
  }
  await writeBrowserDuplicateDecision(userId, signature, true);
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

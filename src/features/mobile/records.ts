/**
 * iPhone アプリの「記録する」と「レシートを撮る」(POST /api/mobile/records・receipts・records/undo、
 * ADR-132)。Web の記録するシート・LINE のレシートと同じ関数で保存する。
 *
 * 本人のセッション(アプリのトークン)の間に呼ぶ。口座は記録するの既定(現金 → 電子マネー → 1つめ)。
 */

import { randomUUID } from 'node:crypto';

import { IPHONE_ENTRY_REF_PREFIX, IPHONE_PHOTO_REF_PREFIX } from '@/domain/today-check';
import { getOrCreateDefaultAccount } from '@/features/accounts/store';
import { importReceiptPhoto } from '@/features/import/line-receipt';
import { ClaudeReceiptExtractor } from '@/features/import/receipt-ai';
import { importTransactions, TransactionStoreError } from '@/features/transactions/store';
import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import { addDays, todayJst } from '@/lib/date';
import { readAnthropicApiKey } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import type {
  MobileReceiptResult,
  MobileRecord,
  MobileRecordInput,
  MobileRecordResult,
  MobileUndoResult,
} from './contract';
import { withGenreNames } from './today';

/** 1件で記録できる上限(円)。 */
const MAX_RECORD_YEN = 10_000_000;
/** 写真(base64)の上限。アプリ側で縮めてから送る(約 4.5MB の画像相当)。 */
export const MAX_PHOTO_BASE64_CHARS = 6_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 入力を確かめる(金額・日付・名前)。だめならその理由。 */
export function recordInputError(input: MobileRecordInput, today: string): string | null {
  if (
    !Number.isInteger(input.amountYen) ||
    input.amountYen < 1 ||
    input.amountYen > MAX_RECORD_YEN
  ) {
    return '金額を入れてください(1円〜1,000万円)。';
  }
  if (input.occurredOn !== undefined) {
    if (!DATE.test(input.occurredOn)) return '日付が読めませんでした。';
    // 先の日付は1年先まで(予定)、前の日付は10年前まで。
    if (input.occurredOn > addDays(today, 366) || input.occurredOn < addDays(today, -3660)) {
      return '日付が遠すぎます。';
    }
  }
  if (input.label !== undefined && input.label.trim().length > 60) {
    return '名前は60文字までにしてください。';
  }
  return null;
}

async function genreNameOf(userId: string, genreId: string | null): Promise<string | null> {
  if (genreId === null) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('genres')
    .select('id, name')
    .eq('user_id', userId)
    .eq('id', genreId)
    .maybeSingle();
  return data?.name ?? null;
}

/** 支出を1件記録する(Web の記録するシートと同じ形)。 */
export async function recordExpense(
  userId: string,
  input: MobileRecordInput,
): Promise<MobileRecordResult> {
  const today = todayJst();
  const invalid = recordInputError(input, today);
  if (invalid) return { record: null, error: invalid };
  // 本人のカテゴリか確かめる(他人のカテゴリの ID は使えない)。
  const genreName = await genreNameOf(userId, input.genreId);
  if (input.genreId !== null && genreName === null) {
    return { record: null, error: 'カテゴリが見つかりませんでした。' };
  }

  const account = await getOrCreateDefaultAccount();
  const date = input.occurredOn ?? today;
  const label = input.label?.trim() || genreName || '手入力';
  const sourceRef = `${IPHONE_ENTRY_REF_PREFIX}${randomUUID()}`;
  const preview: StoredTransaction = {
    id: 'iphone-entry-0',
    accountId: account.id,
    occurredOn: date,
    description: label,
    merchantName: label,
    amountYen: -input.amountYen,
    paymentMethod: 'one_time',
    genreId: input.genreId,
    genreName,
    classifiedBy: input.genreId ? 'manual' : 'unclassified',
    confidence: null,
    reviewStatus: 'auto_ok',
    mustPay: false,
    kind: 'normal',
    source: 'manual',
    fingerprint: fingerprintOf({
      occurredOn: date,
      amountYen: -input.amountYen,
      description: label,
    }),
    batchId: null,
    sourceRef,
    memo: null,
  };

  let result;
  try {
    result = await importTransactions([preview], {
      fileName: 'iPhone',
      source: 'manual',
      accountId: account.id,
      failedCount: 0,
    });
  } catch (error) {
    return {
      record: null,
      error: error instanceof TransactionStoreError ? error.message : '保存できませんでした。',
    };
  }
  const inserted = result.insertedTransactions.find((t) => t.sourceRef === sourceRef);
  if (!inserted) {
    return {
      record: null,
      error: `この日はもう「${label} ${input.amountYen.toLocaleString('ja-JP')}円」の記録があります。`,
    };
  }
  return {
    record: {
      id: inserted.id,
      occurredOn: date,
      label,
      amountYen: -input.amountYen,
      genreId: input.genreId,
      genreName,
    },
    error: null,
  };
}

/** 撮ったレシートを読み取って、そのまま記録する(LINE のレシートと同じ。答え合わせで確かめる)。 */
export async function recordReceiptPhoto(
  userId: string,
  imageBase64: string,
): Promise<MobileReceiptResult> {
  const empty = { records: [], duplicates: 0, merged: 0, warnings: [] };
  if (imageBase64.trim() === '') return { ...empty, error: '写真がありません。' };
  if (imageBase64.length > MAX_PHOTO_BASE64_CHARS) {
    return { ...empty, error: '写真が大きすぎます。' };
  }
  const apiKey = readAnthropicApiKey();
  if (apiKey === null)
    return { ...empty, error: 'いまはレシートを読み取れません(AIの設定がありません)。' };

  const supabase = await createClient();
  const account = await getOrCreateDefaultAccount();
  const photoId = randomUUID();
  const result = await importReceiptPhoto(supabase, userId, {
    accountId: account.id,
    extractor: new ClaudeReceiptExtractor(apiKey),
    imageBase64,
    mediaType: 'image/jpeg',
    sourceRefOf: (index) => `${IPHONE_PHOTO_REF_PREFIX}${photoId}-${index}`,
    fileName: 'iPhone',
  });
  if (result.preview.length === 0) {
    return {
      ...empty,
      warnings: result.warnings,
      error: result.warnings[0] ?? 'レシートとして読み取れませんでした。',
    };
  }

  const byRef = new Map(result.inserted.map((t) => [t.sourceRef, t.id]));
  const records: MobileRecord[] = result.preview.flatMap((t) => {
    const id = t.sourceRef ? byRef.get(t.sourceRef) : undefined;
    return id
      ? [
          {
            id,
            occurredOn: t.occurredOn,
            label: (t.merchantName ?? '').trim() || t.description,
            amountYen: t.amountYen,
            genreId: t.genreId,
            genreName: t.genreName,
          },
        ]
      : [];
  });
  return {
    records: await withGenreNames(userId, records),
    duplicates: result.duplicates,
    merged: result.merged,
    warnings: result.warnings,
    error: null,
  };
}

/** いまアプリから入れた記録を取り消す(アプリから入れた記録だけ。ほかの記録は消さない)。 */
export async function undoMobileRecords(
  userId: string,
  ids: readonly string[],
): Promise<MobileUndoResult> {
  const unique = [...new Set(ids)].slice(0, 20);
  if (unique.length === 0) return { removed: 0, error: null };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transactions')
    .select('id, source_ref')
    .eq('user_id', userId)
    .in('id', unique);
  if (error) return { removed: 0, error: '取り消せませんでした。' };
  const own = (data ?? [])
    .filter(
      (r) =>
        r.source_ref?.startsWith(IPHONE_ENTRY_REF_PREFIX) ||
        r.source_ref?.startsWith(IPHONE_PHOTO_REF_PREFIX),
    )
    .map((r) => r.id);
  if (own.length === 0) return { removed: 0, error: 'この記録はアプリからは取り消せません。' };
  // カードの通知メールと1件にまとめたレシートは消さない(品目を移してあるので、答え合わせで分ける)。
  const { data: merges } = await supabase
    .from('payment_merges')
    .select('merged_transaction_id')
    .eq('user_id', userId)
    .in('merged_transaction_id', own);
  if ((merges ?? []).length > 0) {
    return {
      removed: 0,
      error: 'カードの通知メールと1件にまとめたので、答え合わせの「分ける」から直してください。',
    };
  }
  const { error: deleteError } = await supabase
    .from('transactions')
    .delete()
    .eq('user_id', userId)
    .in('id', own);
  if (deleteError) return { removed: 0, error: '取り消せませんでした。' };
  return { removed: own.length, error: null };
}

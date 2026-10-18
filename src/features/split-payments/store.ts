/** 割り勘の依頼と受取チェックだけを保存し、明細・残高・収支には触れない。 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import { MAX_YEN } from '@/domain/money';
import { buildSplitPaymentRequest, type SplitPaymentEntry } from '@/domain/split-payment-request';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/types';
import {
  MAX_TRACKING_IMPORT,
  parseTrackedSplitPayment,
  splitPaymentTrackingInputSchema,
  trackingIdSchema,
  type TrackedSplitPayment,
  type TrackingListResult,
  type TrackingSaveResult,
} from './types';

const table = 'split_payment_requests';
const columns =
  'id, signature, entries, participants, total_yen, amount_per_person_yen, received_count, version, created_at';
const authMessage = 'ログイン状態を確認できませんでした。もう一度ログインしてください。';
const conflictMessage = '別の画面で受取状況が変更されました。ホームを更新して確認してください。';
const updateInput = z.object({
  id: trackingIdSchema,
  expectedVersion: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1),
  receivedCount: z
    .number()
    .int()
    .min(0)
    .max(MAX_YEN - 1),
});
const deleteInput = updateInput.omit({ receivedCount: true });

function missingTable(error: { code?: string }): boolean {
  return error.code === 'PGRST205' || error.code === '42P01';
}

function canonicalRequest(entries: readonly SplitPaymentEntry[], participants: number) {
  const input = splitPaymentTrackingInputSchema.safeParse({ entries, participants });
  if (!input.success) throw new Error('人数と明細を確認してください。');
  const request = buildSplitPaymentRequest(input.data.entries, input.data.participants);
  // 確認・分類だけの変更で同じ請求を増やさず、送る文面の内容で識別する。
  const sorted = request.entries
    .map(({ id, occurredOn, label, branchName, amountYen }) => ({
      id,
      occurredOn,
      label,
      branchName,
      amountYen,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const signature = createHash('sha256')
    .update(JSON.stringify({ entries: sorted, participants: request.participants }))
    .digest('hex');
  return { ...request, signature };
}

function toTracked(row: {
  id: string;
  signature: string;
  entries: Json;
  participants: number;
  total_yen: number;
  amount_per_person_yen: number;
  received_count: number;
  version: number;
  created_at: string;
}): TrackedSplitPayment {
  return parseTrackedSplitPayment({
    id: row.id,
    signature: row.signature,
    entries: row.entries,
    participants: row.participants,
    totalYen: row.total_yen,
    amountPerPersonYen: row.amount_per_person_yen,
    receivedCount: row.received_count,
    version: row.version,
    createdAt: row.created_at,
  });
}

function toInsert(request: TrackedSplitPayment, userId: string) {
  return {
    id: request.id,
    user_id: userId,
    signature: request.signature,
    entries: request.entries as unknown as Json,
    participants: request.participants,
    total_yen: request.totalYen,
    amount_per_person_yen: request.amountPerPersonYen,
    received_count: request.receivedCount,
    version: request.version,
    created_at: request.createdAt,
  };
}

function newTracked(
  entries: readonly SplitPaymentEntry[],
  participants: number,
): TrackedSplitPayment {
  const request = canonicalRequest(entries, participants);
  return {
    id: randomUUID(),
    signature: request.signature,
    entries: request.entries,
    participants: request.participants,
    totalYen: request.totalYen,
    amountPerPersonYen: request.amountPerPersonYen,
    receivedCount: 0,
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

/** 呼び出しごとの本人認証。Server Actionの引数にuser_idは受け取らない。 */
async function authenticated() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error(authMessage);
  return { supabase, userId: data.user.id };
}

function message(error: unknown, fallback: string) {
  // 接続障害の内部情報は画面に出さない。入力検査・競合の日本語だけ引き継ぐ。
  return error instanceof Error && /[ぁ-んァ-ヶ一-龠]/u.test(error.message)
    ? error.message
    : fallback;
}

export async function loadSplitPaymentTracking(): Promise<TrackingListResult> {
  let userId: string | null = null;
  try {
    const session = await authenticated();
    userId = session.userId;
    const requests: TrackedSplitPayment[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await session.supabase
        .from(table)
        .select(columns)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id')
        .range(offset, offset + 999);
      if (error) {
        if (missingTable(error)) return { userId, storage: 'browser', requests: [], error: null };
        throw new Error('割り勘の受取状況を取得できませんでした。もう一度お試しください。');
      }
      requests.push(...data.map(toTracked));
      if (data.length < 1000) break;
    }
    return { userId, storage: 'database', requests, error: null };
  } catch (error) {
    return {
      userId,
      storage: 'database',
      requests: [],
      error: message(error, '割り勘の受取状況を取得できませんでした。'),
    };
  }
}

export async function saveSplitPaymentTracking(input: {
  entries: readonly SplitPaymentEntry[];
  participants: number;
}): Promise<TrackingSaveResult> {
  let userId: string | null = null;
  try {
    const session = await authenticated();
    userId = session.userId;
    const request = newTracked(input.entries, input.participants);
    const { error } = await session.supabase.from(table).upsert(toInsert(request, userId), {
      onConflict: 'user_id,signature',
      ignoreDuplicates: true,
    });
    if (error) {
      if (missingTable(error)) return { userId, storage: 'browser', request, error: null };
      throw new Error('割り勘の依頼を保存できませんでした。もう一度お試しください。');
    }
    // 再コピー時は既存の受取状況を必ず採用し、0人へ戻さない。
    const { data, error: readError } = await session.supabase
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .eq('signature', request.signature)
      .maybeSingle();
    if (readError || !data)
      throw new Error('割り勘の保存結果を確認できませんでした。もう一度お試しください。');
    return { userId, storage: 'database', request: toTracked(data), error: null };
  } catch (error) {
    return {
      userId,
      storage: 'database',
      request: null,
      error: message(error, '割り勘の依頼を保存できませんでした。'),
    };
  }
}

export async function updateSplitPaymentReceived(input: {
  id: string;
  expectedVersion: number;
  receivedCount: number;
}): Promise<TrackingSaveResult> {
  let userId: string | null = null;
  try {
    const session = await authenticated();
    userId = session.userId;
    const parsed = updateInput.safeParse(input);
    if (!parsed.success) throw new Error('受取人数を確認してください。');
    const { data, error } = await session.supabase
      .from(table)
      .update({
        received_count: parsed.data.receivedCount,
        version: parsed.data.expectedVersion + 1,
      })
      .eq('id', parsed.data.id)
      .eq('user_id', userId)
      .eq('version', parsed.data.expectedVersion)
      .gte('participants', parsed.data.receivedCount + 1)
      .select(columns)
      .maybeSingle();
    if (error) throw new Error('受取状況を保存できませんでした。もう一度お試しください。');
    if (!data) throw new Error(conflictMessage);
    return { userId, storage: 'database', request: toTracked(data), error: null };
  } catch (error) {
    return {
      userId,
      storage: 'database',
      request: null,
      error: message(error, '受取状況を保存できませんでした。'),
    };
  }
}

export async function deleteSplitPaymentTracking(input: {
  id: string;
  expectedVersion: number;
}): Promise<{ error: string | null }> {
  try {
    const { supabase, userId } = await authenticated();
    const parsed = deleteInput.safeParse(input);
    if (!parsed.success) throw new Error('削除する割り勘の依頼を確認してください。');
    const { data, error } = await supabase
      .from(table)
      .delete()
      .eq('id', parsed.data.id)
      .eq('user_id', userId)
      .eq('version', parsed.data.expectedVersion)
      .select('id')
      .maybeSingle();
    if (error) throw new Error('割り勘の依頼を削除できませんでした。もう一度お試しください。');
    if (!data) throw new Error(conflictMessage);
    return { error: null };
  } catch (error) {
    return { error: message(error, '割り勘の依頼を削除できませんでした。') };
  }
}

/**
 * テーブル適用後の再コピーで先に作られた未操作の0人行だけ、端末のチェックを引き継ぐ。
 * DBで一度でも操作したversion>=2の行（チェックの取消を含む）は上書きしない。
 */
async function recoverBrowserReceivedCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  request: TrackedSplitPayment,
) {
  if (request.receivedCount === 0) return;
  const read = () =>
    supabase
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .eq('signature', request.signature)
      .maybeSingle();
  const { data, error } = await read();
  if (error || !data) {
    throw new Error('割り勘の引き継ぎ結果を確認できませんでした。もう一度お試しください。');
  }
  const stored = toTracked(data);
  if (stored.receivedCount !== 0 || stored.version > 1) return;
  const { data: updated, error: updateError } = await supabase
    .from(table)
    .update({ received_count: request.receivedCount, version: stored.version + 1 })
    .eq('id', stored.id)
    .eq('user_id', userId)
    .eq('version', stored.version)
    .eq('received_count', 0)
    .select(columns)
    .maybeSingle();
  if (updateError) {
    throw new Error('受取状況を引き継げませんでした。もう一度お試しください。');
  }
  if (updated) return;
  // 他の画面と競合した場合、そこで操作された最新DB状態を採用する。
  const latest = await read();
  if (latest.error || !latest.data) {
    throw new Error('受取状況の引き継ぎ結果を確認できませんでした。もう一度お試しください。');
  }
  const current = toTracked(latest.data);
  if (current.receivedCount === 0 && current.version <= 1) {
    // 端末のチェックが保存されたと確認できない間は成功を返さず、端末保存を残す。
    throw new Error('受取状況を引き継げませんでした。もう一度お試しください。');
  }
}

/** ブラウザ保存は本人のメタデータ。操作済みDB状態を優先し、署名・金額は再計算する。 */
export async function importBrowserSplitPaymentTracking(
  requests: readonly TrackedSplitPayment[],
): Promise<TrackingListResult> {
  let userId: string | null = null;
  try {
    const session = await authenticated();
    userId = session.userId;
    if (!Array.isArray(requests) || requests.length > MAX_TRACKING_IMPORT) {
      throw new Error('引き継ぐ割り勘の依頼は100件以内にしてください。');
    }
    const imported = requests.map((value) => {
      const source = parseTrackedSplitPayment(value);
      const request = newTracked(source.entries, source.participants);
      return { ...request, receivedCount: source.receivedCount, createdAt: source.createdAt };
    });
    const unique = [...new Map(imported.map((request) => [request.signature, request])).values()];
    if (unique.length > 0) {
      const { error } = await session.supabase.from(table).upsert(
        unique.map((request) => toInsert(request, userId!)),
        {
          onConflict: 'user_id,signature',
          ignoreDuplicates: true,
        },
      );
      if (error) {
        if (missingTable(error)) return { userId, storage: 'browser', requests: [], error: null };
        throw new Error('このブラウザの割り勘を引き継げませんでした。もう一度お試しください。');
      }
      for (const request of unique) {
        await recoverBrowserReceivedCount(session.supabase, userId, request);
      }
    }
    // 認証を省略する経路を作らず、通常の一覧取得と同じ検査で返す。
    const loaded = await loadSplitPaymentTracking();
    if (loaded.error || loaded.storage !== 'database') return loaded;
    const bySignature = new Map(loaded.requests.map((request) => [request.signature, request]));
    const conflicts = unique
      .filter((source) => {
        const stored = bySignature.get(source.signature);
        return stored !== undefined && stored.receivedCount !== source.receivedCount;
      })
      .map((request) => request.signature);
    // 再読込のたびに端末の元データと比較し、不一致を無言で端末から消さない。
    return { ...loaded, conflicts };
  } catch (error) {
    return {
      userId,
      storage: 'database',
      requests: [],
      error: message(error, 'このブラウザの割り勘を引き継げませんでした。'),
    };
  }
}

/**
 * 今日の答え合わせ(v4-1、ADR-129)のデータアクセス。選び方・並び方は domain/today-check.ts。
 *
 * アプリ(本人のセッション)と、LINE・夜の配信(本人のセッションが無い経路。管理クライアント + 明示的な
 * user_id)の両方から使うので、どの関数も client と userId を受け取り、user_id で絞って読み書きする。
 * 「確認が必要」(/spending/review)と同じ review_status を変えるので、どちらで片づけても両方から消える。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { STORE_WIDE_ITEM } from '@/domain/classification-pipeline';
import { comparableKey } from '@/domain/store-name';
import {
  checkWindowStart,
  pickCheckItems,
  type CheckRow,
  type TodayCheckItem,
} from '@/domain/today-check';
import { rememberStoreChoice } from '@/features/classification/import-classify';
import { loadMergedNotes } from '@/features/transactions/payment-merge';
import { AppError } from '@/lib/errors';
import type { Database } from '@/lib/supabase/types';
import type { DateOnly } from '@/lib/date';

type Client = SupabaseClient<Database>;

export class TodayCheckError extends AppError {}

export type { TodayCheckItem };

export async function listTodayCheck(
  client: Client,
  userId: string,
  today: DateOnly,
): Promise<TodayCheckItem[]> {
  const { data, error } = await client
    .from('transactions')
    .select(
      'id, occurred_on, created_at, merchant_name, description, branch_name, amount_yen, genre_id, review_status, source, source_ref, is_transfer',
    )
    .eq('user_id', userId)
    .in('review_status', ['auto_ok', 'pending'])
    .in('source', ['gmail', 'csv', 'manual'])
    .gte('occurred_on', checkWindowStart(today))
    .lte('occurred_on', today)
    .order('occurred_on', { ascending: false })
    .limit(300);
  if (error) throw new TodayCheckError(`答え合わせの記録を読めませんでした: ${error.message}`);

  const rows: CheckRow[] = (data ?? []).map((r) => ({
    id: r.id,
    occurredOn: r.occurred_on,
    createdAt: r.created_at,
    merchantName: r.merchant_name,
    description: r.description,
    branchName: r.branch_name,
    amountYen: r.amount_yen,
    genreId: r.genre_id,
    reviewStatus: r.review_status,
    source: r.source,
    sourceRef: r.source_ref,
    isTransfer: r.is_transfer,
  }));
  const picked = pickCheckItems(rows, today, { genreNameById: new Map() });
  if (picked.length === 0) return [];

  const ids = picked.map((item) => item.id);
  const genreIds = [...new Set(picked.flatMap((item) => (item.genreId ? [item.genreId] : [])))];
  const [genres, items, notes] = await Promise.all([
    genreIds.length > 0
      ? client.from('genres').select('id, name').eq('user_id', userId).in('id', genreIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    client
      .from('receipt_items')
      .select('transaction_id, name, sort_order')
      .eq('user_id', userId)
      .in('transaction_id', ids)
      .order('sort_order'),
    loadMergedNotes(client, userId, ids).catch(() => new Map<string, string>()),
  ]);
  const firstItemById = new Map<string, string>();
  for (const item of items.data ?? []) {
    if (!firstItemById.has(item.transaction_id)) firstItemById.set(item.transaction_id, item.name);
  }
  return pickCheckItems(rows, today, {
    genreNameById: new Map((genres.data ?? []).map((g) => [g.id, g.name])),
    firstItemById,
    mergedNoteById: notes,
  });
}

export type CheckAction = 'confirm' | 'correct' | 'ignore';

/** 「ひとつ戻る」で元に戻すための、操作の前の状態。 */
export type CheckUndo = {
  id: string;
  prev: {
    reviewStatus: 'auto_ok' | 'pending';
    genreId: string | null;
    classifiedBy: 'unclassified' | 'rule' | 'ai' | 'manual';
    reviewedAt: string | null;
  };
  /** お店の覚え方を変えたときの、前の覚え方(無ければ null = 覚えていなかった)。 */
  memory: {
    storeKey: string;
    prev: { genreId: string; pinned: boolean; hits: number } | null;
  } | null;
};

async function ownGenre(client: Client, userId: string, genreId: string): Promise<boolean> {
  const { data } = await client
    .from('genres')
    .select('id')
    .eq('user_id', userId)
    .eq('id', genreId)
    .maybeSingle();
  return data !== null;
}

/**
 * 合ってる(confirmed)・直す(corrected、カテゴリを変える)・数えない(ignored)。直したお店は次から
 * そのカテゴリに、合ってると押したお店はそのカテゴリの自信を上げる。戻すための前の状態を返す。
 */
export async function applyTodayCheck(
  client: Client,
  userId: string,
  input: { id: string; action: CheckAction; genreId?: string | null },
): Promise<CheckUndo> {
  const { data: row, error } = await client
    .from('transactions')
    .select('id, genre_id, classified_by, review_status, reviewed_at, merchant_name, description')
    .eq('user_id', userId)
    .eq('id', input.id)
    .maybeSingle();
  if (error || !row) throw new TodayCheckError('この記録は見つかりませんでした。');
  if (row.review_status !== 'auto_ok' && row.review_status !== 'pending') {
    throw new TodayCheckError('この記録は、もう確かめてあります。');
  }

  const genreId = input.action === 'correct' ? (input.genreId ?? null) : row.genre_id;
  if (
    input.action === 'correct' &&
    (genreId === null || !(await ownGenre(client, userId, genreId)))
  ) {
    throw new TodayCheckError('カテゴリを選んでください。');
  }

  const storeName = (row.merchant_name ?? '').trim() || row.description;
  const storeKey = comparableKey(storeName);
  const remember = input.action !== 'ignore' && genreId !== null && storeKey !== '';
  const memoryBefore = remember
    ? await client
        .from('genre_memory')
        .select('genre_id, pinned, hits')
        .eq('user_id', userId)
        .eq('store_key', storeKey)
        .eq('item_key', STORE_WIDE_ITEM)
        .maybeSingle()
    : null;

  const now = new Date().toISOString();
  const patch =
    input.action === 'confirm'
      ? { review_status: 'confirmed' as const, reviewed_at: now }
      : input.action === 'ignore'
        ? { review_status: 'ignored' as const, reviewed_at: now }
        : {
            review_status: 'corrected' as const,
            reviewed_at: now,
            genre_id: genreId,
            classified_by: 'manual' as const,
          };
  const { error: updateError } = await client
    .from('transactions')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', input.id);
  if (updateError) throw new TodayCheckError(`保存できませんでした: ${updateError.message}`);

  if (remember) {
    await rememberStoreChoice(client, userId, {
      storeName,
      genreId: genreId!,
      pin: input.action === 'correct',
    }).catch(() => {});
  }

  return {
    id: row.id,
    prev: {
      reviewStatus: row.review_status,
      genreId: row.genre_id,
      classifiedBy: row.classified_by,
      reviewedAt: row.reviewed_at,
    },
    memory: remember
      ? {
          storeKey,
          prev: memoryBefore?.data
            ? {
                genreId: memoryBefore.data.genre_id,
                pinned: memoryBefore.data.pinned,
                hits: memoryBefore.data.hits,
              }
            : null,
        }
      : null,
  };
}

const REVIEW_STATUSES = new Set(['auto_ok', 'pending']);
const CLASSIFIED_BY = new Set(['unclassified', 'rule', 'ai', 'manual']);

/** 「ひとつ戻る」:直前の操作の前の状態に戻す(お店の覚え方も戻す)。 */
export async function undoTodayCheck(
  client: Client,
  userId: string,
  undo: CheckUndo,
): Promise<void> {
  const { prev } = undo;
  if (!REVIEW_STATUSES.has(prev.reviewStatus) || !CLASSIFIED_BY.has(prev.classifiedBy)) {
    throw new TodayCheckError('元に戻せませんでした。');
  }
  if (prev.genreId !== null && !(await ownGenre(client, userId, prev.genreId))) {
    throw new TodayCheckError('元に戻せませんでした。');
  }
  const { error } = await client
    .from('transactions')
    .update({
      review_status: prev.reviewStatus,
      genre_id: prev.genreId,
      classified_by: prev.classifiedBy,
      reviewed_at: prev.reviewedAt,
    })
    .eq('user_id', userId)
    .eq('id', undo.id);
  if (error) throw new TodayCheckError(`元に戻せませんでした: ${error.message}`);

  if (undo.memory && undo.memory.storeKey !== '') {
    const before = undo.memory.prev;
    if (before === null) {
      await client
        .from('genre_memory')
        .delete()
        .eq('user_id', userId)
        .eq('store_key', undo.memory.storeKey)
        .eq('item_key', STORE_WIDE_ITEM);
    } else if (await ownGenre(client, userId, before.genreId)) {
      await client.from('genre_memory').upsert(
        {
          user_id: userId,
          store_key: undo.memory.storeKey,
          item_key: STORE_WIDE_ITEM,
          genre_id: before.genreId,
          pinned: before.pinned,
          hits: Math.max(1, Math.round(before.hits)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,store_key,item_key' },
      );
    }
  }
}

/** 「まとめて合ってる」(LINE の夜の答え合わせ):自信のあるもの(auto_ok)だけを確定する。 */
export async function confirmSureTodayCheck(
  client: Client,
  userId: string,
  today: DateOnly,
): Promise<{ confirmed: number; remaining: TodayCheckItem[] }> {
  const items = await listTodayCheck(client, userId, today);
  const sure = items.filter((item) => !item.unsure);
  let confirmed = 0;
  for (const item of sure) {
    try {
      await applyTodayCheck(client, userId, { id: item.id, action: 'confirm' });
      confirmed += 1;
    } catch {
      // 別の画面で先に片づけたものは飛ばす
    }
  }
  return { confirmed, remaining: items.filter((item) => item.unsure) };
}

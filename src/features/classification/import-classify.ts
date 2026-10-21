/**
 * 自動で取り込んだ明細のカテゴリを、取り込むときに付ける(v4「自信のないときだけ聞く」、ADR-129)。
 * 判断は domain/import-classification.ts の純粋関数、ここは読み書きだけ。
 *
 * Gmail の自動取り込み・LINE の受信は本人のセッションが無い経路なので、どれも管理クライアント +
 * 明示的な user_id で読む(セッションの経路では本人のクライアントを渡す)。テーブルが無い・読めない
 * ときは、カテゴリを付けずに「確かめる」へ回すだけで、取り込みは止めない。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { STORE_WIDE_ITEM, type ClassificationMemory } from '@/domain/classification-pipeline';
import {
  classifyImported,
  DEFAULT_CONFIDENCE_THRESHOLD,
  type ImportClassifyContext,
} from '@/domain/import-classification';
import { comparableKey } from '@/domain/store-name';
import type { Database } from '@/lib/supabase/types';

type Client = SupabaseClient<Database>;

export async function loadImportClassifyContext(
  client: Client,
  userId: string,
): Promise<ImportClassifyContext> {
  const [memoryRows, genreRows, settings] = await Promise.all([
    client
      .from('genre_memory')
      .select('store_key, item_key, genre_id, pinned, hits')
      .eq('user_id', userId)
      .eq('item_key', STORE_WIDE_ITEM),
    client.from('genres').select('id, name').eq('user_id', userId),
    client
      .from('app_settings')
      .select('classification_confidence_threshold')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  const memory: ClassificationMemory = new Map();
  for (const row of memoryRows.data ?? []) {
    memory.set(`${row.store_key}|${row.item_key}`, {
      genreId: row.genre_id,
      pinned: row.pinned,
      hits: row.hits,
    });
  }
  const threshold = settings.data?.classification_confidence_threshold;
  return {
    memory,
    genreIdByName: new Map((genreRows.data ?? []).map((g) => [g.name, g.id])),
    threshold:
      typeof threshold === 'number' && threshold > 0 && threshold <= 1
        ? threshold
        : DEFAULT_CONFIDENCE_THRESHOLD,
  };
}

type ClassifiableRow = {
  merchantName: string | null;
  description: string;
  genreId: string | null;
  classifiedBy: 'unclassified' | 'rule' | 'ai' | 'manual';
  confidence: number | null;
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
};

/**
 * まだカテゴリの無い行にだけ、カテゴリ・自信・確かめるかを付ける(本人が選んだカテゴリは変えない)。
 * 読めなかったときは、カテゴリの無い行を「確かめる」に回すだけにする。
 */
export async function classifyImportRows<T extends ClassifiableRow>(
  client: Client,
  userId: string,
  rows: readonly T[],
): Promise<T[]> {
  if (!rows.some((row) => row.genreId === null)) return [...rows];
  const ctx = await loadImportClassifyContext(client, userId).catch(() => null);
  const nameById = new Map([...(ctx?.genreIdByName ?? [])].map(([name, id]) => [id, name]));
  return rows.map((row) => {
    if (row.genreId !== null) return row;
    if (ctx === null) return { ...row, reviewStatus: 'pending' };
    const hit = classifyImported(row, ctx);
    return {
      ...row,
      genreId: hit.genreId,
      ...('genreName' in row
        ? { genreName: hit.genreId ? (nameById.get(hit.genreId) ?? null) : null }
        : {}),
      classifiedBy: hit.classifiedBy,
      confidence: hit.confidence,
      reviewStatus: hit.reviewStatus,
    };
  });
}

/**
 * 答え合わせの結果を、次の取り込みに使う(ADR-129)。直したお店は「この店はすべて○○」のルールに
 * (次から自信 1 で付く)、合ってると押したお店は選び方の回数を1つ増やす(ルールは上書きしない)。
 */
export async function rememberStoreChoice(
  client: Client,
  userId: string,
  input: { storeName: string; genreId: string; pin: boolean },
): Promise<void> {
  const storeKey = comparableKey(input.storeName);
  if (storeKey === '') return;
  const { data: prev } = await client
    .from('genre_memory')
    .select('genre_id, pinned, hits')
    .eq('user_id', userId)
    .eq('store_key', storeKey)
    .eq('item_key', STORE_WIDE_ITEM)
    .maybeSingle();
  if (!input.pin && prev?.pinned) return;
  const sameGenre = prev?.genre_id === input.genreId;
  await client.from('genre_memory').upsert(
    {
      user_id: userId,
      store_key: storeKey,
      item_key: STORE_WIDE_ITEM,
      genre_id: input.genreId,
      pinned: input.pin || (sameGenre && (prev?.pinned ?? false)),
      hits: sameGenre ? (prev?.hits ?? 0) + 1 : 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,store_key,item_key' },
  );
}

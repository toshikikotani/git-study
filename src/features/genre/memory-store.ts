/**
 * 分類の記憶(genre_memory:個人の履歴・利用者のルール)のデータアクセス。
 * 判断は domain/classification-pipeline.ts の純粋関数が担い、ここは読み書きだけ。
 * テーブルが本番未適用の間は、読み取りは空、書き込みは黙って何もしない
 * (分類の学習ができないだけで、取り込みは止めない)。
 */

import type { ClassificationMemory } from '@/domain/classification-pipeline';
import { comparableKey } from '@/domain/store-name';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export class GenreMemoryError extends AppError {}

/** 記憶をまとめて読む。 */
export async function loadClassificationMemory(): Promise<ClassificationMemory> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('genre_memory')
    .select('store_key, item_key, genre_id, pinned, hits');
  const memory: ClassificationMemory = new Map();
  if (error) {
    if (isMissingTableError(error)) return memory;
    throw new GenreMemoryError(`分類の履歴を取得できませんでした: ${error.message}`);
  }
  for (const row of data) {
    memory.set(`${row.store_key}|${row.item_key}`, {
      genreId: row.genre_id,
      pinned: row.pinned,
      hits: row.hits,
    });
  }
  return memory;
}

/**
 * 利用者が直したジャンルを履歴へ反映する(即座に)。同じジャンルなら回数を増やし、
 * 別のジャンルへ直したら回数を1に戻して切り替える。pin=true でルールとして固定する。
 */
export async function recordCorrection(input: {
  storeName: string;
  itemName: string;
  genreId: string;
  pin?: boolean;
  anyStore?: boolean;
}): Promise<void> {
  const itemKey = comparableKey(input.itemName);
  if (itemKey === '') return;
  const storeKey = input.anyStore ? '' : comparableKey(input.storeName);

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new GenreMemoryError('ログイン状態を確認できませんでした');

  const { data: prev, error: readError } = await supabase
    .from('genre_memory')
    .select('genre_id, pinned, hits')
    .eq('store_key', storeKey)
    .eq('item_key', itemKey)
    .maybeSingle();
  if (readError) {
    if (isMissingTableError(readError)) return;
    throw new GenreMemoryError(`分類の履歴を取得できませんでした: ${readError.message}`);
  }

  const same = prev?.genre_id === input.genreId;
  const { error } = await supabase.from('genre_memory').upsert(
    {
      user_id: auth.user.id,
      store_key: storeKey,
      item_key: itemKey,
      genre_id: input.genreId,
      pinned: input.pin ?? (same ? prev!.pinned : false),
      hits: same ? prev!.hits + 1 : 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,store_key,item_key' },
  );
  if (error && !isMissingTableError(error)) {
    throw new GenreMemoryError(`分類の履歴を保存できませんでした: ${error.message}`);
  }
}

// ---- 分類ルール(利用者が固定したもの)の管理(カテゴリ詳細 P7・P8)----------------------------

import { STORE_WIDE_ITEM } from '@/domain/classification-pipeline';

export type ClassificationRule = {
  id: string;
  /** 店の比較用キー。空は「どの店でも」。 */
  storeKey: string;
  /** 品目の比較用キー。'*' は「この店はすべて」。 */
  itemKey: string;
  genreId: string;
  hits: number;
};

/** 「この店はすべて○○」のルールを保存する(pinned)。 */
export async function saveStoreRule(storeName: string, genreId: string): Promise<void> {
  const storeKey = comparableKey(storeName);
  if (storeKey === '') return;
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new GenreMemoryError('ログイン状態を確認できませんでした');
  const { error } = await supabase.from('genre_memory').upsert(
    {
      user_id: auth.user.id,
      store_key: storeKey,
      item_key: STORE_WIDE_ITEM,
      genre_id: genreId,
      pinned: true,
      hits: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,store_key,item_key' },
  );
  if (error && !isMissingTableError(error)) {
    throw new GenreMemoryError(`ルールを保存できませんでした: ${error.message}`);
  }
}

/** ジャンルに固定されているルール(利用者のルール = pinned)の一覧。 */
export async function listRulesForGenre(genreId: string): Promise<ClassificationRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('genre_memory')
    .select('id, store_key, item_key, genre_id, hits')
    .eq('genre_id', genreId)
    .eq('pinned', true)
    .order('updated_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new GenreMemoryError(`ルールを取得できませんでした: ${error.message}`);
  }
  return data.map((r) => ({
    id: r.id,
    storeKey: r.store_key,
    itemKey: r.item_key,
    genreId: r.genre_id,
    hits: r.hits,
  }));
}

export async function deleteRule(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('genre_memory').delete().eq('id', id);
  if (error && !isMissingTableError(error)) {
    throw new GenreMemoryError(`ルールを削除できませんでした: ${error.message}`);
  }
}

/** ルールの移動先を変える(P8 の編集)。 */
export async function updateRuleGenre(id: string, genreId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('genre_memory')
    .update({ genre_id: genreId, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error && !isMissingTableError(error)) {
    throw new GenreMemoryError(`ルールを変更できませんでした: ${error.message}`);
  }
}

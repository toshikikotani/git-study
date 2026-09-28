/**
 * 支出ジャンル(genres・transaction_genres・receipt_item_genres)のデータ
 * アクセス(本人発案、ADR-056)。
 *
 * ジャンルの一覧は `categories` と同じく本人が自由に追加・削除できるDB
 * テーブル(本人発案「カテゴリはdbに保存してenumじゃなくて、自由に変更
 * できる仕組みに。追加削除容易にしたい」)。`transaction_diagnoses`
 * (ADR-030)と同じ「今月、まだ処理していない分だけを本人の操作で処理する」
 * 設計で、レシート品目がある明細は品目ごとに、無い明細は明細全体に、
 * どちらか一方だけジャンルを付ける(本人が選んだ「両方(品目があれば
 * 品目ごと、無ければ明細ごと)」のとおり)。
 *
 * `genres`・`transaction_genres`・`receipt_item_genres` は本番未適用。
 * 未適用時の扱いは他の新規テーブル(transaction_diagnoses 等)と同じ
 * (読み取りは「まだ無い」として握り潰す。書き込みは握り潰さずエラーを返す)。
 */

import type { GenredEntry } from '@/domain/genre';
import { isCountable } from '@/domain/budget';
import { monthStartJst, todayJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export class GenreStoreError extends AppError {}

/** 1回の「ジャンル分類する」で処理する上限(品目・明細の合計)。
 * reasoning が無く1件あたりの出力が軽いため、diagnosis(30件)より多めにできる。
 * 超えた分は次回のボタン操作で拾える。 */
const MAX_BATCH_SIZE = 120;

export type Genre = { id: string; name: string; sortOrder: number };

/**
 * ジャンルの初期値(本人はいつでも自由に追加・削除できる。あくまで最初の
 * 目安)。`genres` テーブルに1件も無いユーザーの初回アクセス時にだけ投入する
 * ——本番 Supabase へ新規マイグレーションを適用する手段がこのセッションに
 * 無い制約(T-25/T-26 と同じ)があり、`seed_defaults()`(docs/schema.sql)を
 * 直接呼べないため、アプリ側の遅延投入で補う。
 */
const DEFAULT_GENRE_NAMES = [
  '食料品',
  '外食',
  'カフェ・飲料',
  '酒',
  '日用品',
  '衣服・ファッション',
  '美容',
  '医療・健康',
  '住居費',
  '光熱費',
  '通信費',
  '交通・車両',
  '娯楽・趣味',
  '書籍・学習',
  'サブスクリプション・会費',
  '交際費・贈答',
  'こども・教育',
  'ペット',
  '家電・家具',
  '旅行',
  '保険・税金・手数料',
  'その他',
];

/** ジャンル一覧(並び順)。1件も無ければ初期値を投入してから返す。 */
export async function listGenres(): Promise<Genre[]> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new GenreStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('genres')
    .select('id, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new GenreStoreError(`ジャンルを取得できませんでした: ${error.message}`);
  }
  if (data.length > 0) {
    return data.map((g) => ({ id: g.id, name: g.name, sortOrder: g.sort_order }));
  }

  const { error: insertError } = await supabase.from('genres').insert(
    DEFAULT_GENRE_NAMES.map((name, index) => ({
      user_id: auth.user.id,
      name,
      sort_order: (index + 1) * 10,
    })),
  );
  if (insertError) {
    if (isMissingTableError(insertError)) return [];
    throw new GenreStoreError(`ジャンルの初期値を作成できませんでした: ${insertError.message}`);
  }

  return listGenres();
}

export async function createGenre(name: string): Promise<Genre> {
  const trimmed = name.trim();
  if (trimmed === '') throw new GenreStoreError('ジャンル名を入力してください');

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new GenreStoreError('ログイン状態を確認できませんでした');
  }

  const { data: existing } = await supabase
    .from('genres')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  const nextSortOrder = ((existing?.[0]?.sort_order as number | undefined) ?? 0) + 10;

  const { data, error } = await supabase
    .from('genres')
    .insert({ user_id: auth.user.id, name: trimmed, sort_order: nextSortOrder })
    .select('id, name, sort_order')
    .single();
  if (error) {
    if (isMissingTableError(error)) throw new GenreStoreError('ジャンル機能はまだ利用できません');
    if (error.code === '23505') throw new GenreStoreError('同じ名前のジャンルが既にあります');
    throw new GenreStoreError(`ジャンルを作成できませんでした: ${error.message}`);
  }
  return { id: data.id, name: data.name, sortOrder: data.sort_order };
}

/**
 * ジャンルを削除する(本人発案「追加削除容易にしたい」、categories と違い
 * 統合を経由せず即座に削除できる)。使用中の分類(transaction_genres・
 * receipt_item_genres)は genre_id が on delete cascade のため一緒に消える
 * ——その品目・明細は次回の「ジャンル分類する」で再び対象になる。
 */
export async function deleteGenre(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('genres').delete().eq('id', id);
  if (error) throw new GenreStoreError(`ジャンルを削除できませんでした: ${error.message}`);
}

export type GenreTarget =
  | { kind: 'item'; id: string; label: string; amountYen: number }
  | { kind: 'transaction'; id: string; label: string; amountYen: number };

/**
 * 今月、まだジャンル分類していない支出(収入・振替・対象外は除く、
 * domain/budget.ts の isCountable() と同じ定義)。レシート品目がある明細は
 * 品目ごとに、無い明細は明細全体を対象にする。
 */
export async function listUngenredSpendTargets(now: Date = new Date()): Promise<GenreTarget[]> {
  const supabase = await createClient();
  const monthStart = monthStartJst(0, now);
  const today = todayJst(now);

  const { data: rows, error } = await supabase
    .from('transactions')
    .select(
      'id, description, merchant_name, amount_yen, occurred_on, is_transfer, review_status, category_id',
    )
    .gte('occurred_on', monthStart)
    .lte('occurred_on', today)
    .lt('amount_yen', 0)
    .order('occurred_on', { ascending: false });
  if (error) throw new GenreStoreError(`明細を取得できませんでした: ${error.message}`);

  const countable = rows.filter((r) =>
    isCountable({
      categoryId: r.category_id,
      amountYen: r.amount_yen,
      isTransfer: r.is_transfer,
      reviewStatus: r.review_status,
    }),
  );
  if (countable.length === 0) return [];
  const countableIds = countable.map((r) => r.id);

  const { data: items, error: itemsError } = await supabase
    .from('receipt_items')
    .select('id, transaction_id, name, amount_yen')
    .in('transaction_id', countableIds);
  if (itemsError && !isMissingTableError(itemsError)) {
    throw new GenreStoreError(`品目を取得できませんでした: ${itemsError.message}`);
  }
  const itemsByTransaction = new Map<string, { id: string; name: string; amount_yen: number }[]>();
  for (const item of items ?? []) {
    const list = itemsByTransaction.get(item.transaction_id) ?? [];
    list.push(item);
    itemsByTransaction.set(item.transaction_id, list);
  }

  const allItems = [...itemsByTransaction.values()].flat();
  const { data: itemGenres, error: itemGenresError } = await supabase
    .from('receipt_item_genres')
    .select('receipt_item_id')
    .in(
      'receipt_item_id',
      allItems.map((i) => i.id),
    );
  if (itemGenresError && !isMissingTableError(itemGenresError)) {
    throw new GenreStoreError(
      `ジャンル分類の状況を取得できませんでした: ${itemGenresError.message}`,
    );
  }
  const genredItemIds = new Set((itemGenres ?? []).map((g) => g.receipt_item_id));

  const transactionsWithoutItems = countable.filter(
    (r) => (itemsByTransaction.get(r.id) ?? []).length === 0,
  );
  const { data: txGenres, error: txGenresError } = await supabase
    .from('transaction_genres')
    .select('transaction_id')
    .in(
      'transaction_id',
      transactionsWithoutItems.map((r) => r.id),
    );
  if (txGenresError && !isMissingTableError(txGenresError)) {
    throw new GenreStoreError(`ジャンル分類の状況を取得できませんでした: ${txGenresError.message}`);
  }
  const genredTransactionIds = new Set((txGenres ?? []).map((g) => g.transaction_id));

  const targets: GenreTarget[] = [];
  for (const item of allItems) {
    if (genredItemIds.has(item.id)) continue;
    targets.push({ kind: 'item', id: item.id, label: item.name, amountYen: item.amount_yen });
  }
  for (const tx of transactionsWithoutItems) {
    if (genredTransactionIds.has(tx.id)) continue;
    targets.push({
      kind: 'transaction',
      id: tx.id,
      label: tx.merchant_name ?? tx.description,
      amountYen: Math.abs(tx.amount_yen),
    });
  }

  return targets.slice(0, MAX_BATCH_SIZE);
}

/** ジャンル分類の結果を保存する。品目と明細で保存先テーブルが違うため分けて upsert する。 */
export async function saveGenres(
  results: readonly { kind: 'item' | 'transaction'; id: string; genreId: string }[],
): Promise<void> {
  if (results.length === 0) return;

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new GenreStoreError('ログイン状態を確認できませんでした');
  }

  const itemResults = results.filter((r) => r.kind === 'item');
  const transactionResults = results.filter((r) => r.kind === 'transaction');

  if (itemResults.length > 0) {
    const { error } = await supabase.from('receipt_item_genres').upsert(
      itemResults.map((r) => ({
        user_id: auth.user.id,
        receipt_item_id: r.id,
        genre_id: r.genreId,
      })),
      { onConflict: 'receipt_item_id' },
    );
    if (error) {
      if (isMissingTableError(error))
        throw new GenreStoreError('ジャンル分類機能はまだ利用できません');
      throw new GenreStoreError(`ジャンル分類を保存できませんでした: ${error.message}`);
    }
  }

  if (transactionResults.length > 0) {
    const { error } = await supabase.from('transaction_genres').upsert(
      transactionResults.map((r) => ({
        user_id: auth.user.id,
        transaction_id: r.id,
        genre_id: r.genreId,
      })),
      { onConflict: 'transaction_id' },
    );
    if (error) {
      if (isMissingTableError(error))
        throw new GenreStoreError('ジャンル分類機能はまだ利用できません');
      throw new GenreStoreError(`ジャンル分類を保存できませんでした: ${error.message}`);
    }
  }
}

export type GenreAnalysisView = {
  entries: readonly GenredEntry[];
  /** 今月、まだジャンル分類していない品目・明細の件数。0 ならボタンは不要。 */
  pendingCount: number;
};

/**
 * 「第三者目線での分析」画面向けのビュー(本人発案)。今月分の、本人が選んだ
 * カテゴリと、AIが割り当てた客観ジャンルの組を1回の呼び出しでまとめて返す。
 * 集計そのものは domain/genre.ts の summarizeByGenre()/summarizeGenreByCategory()
 * が担う(ここではDBから素材を集めるだけ)。
 */
export async function loadGenreAnalysisView(now: Date = new Date()): Promise<GenreAnalysisView> {
  const supabase = await createClient();
  const monthStart = monthStartJst(0, now);
  const today = todayJst(now);

  const { data: rows, error } = await supabase
    .from('transactions')
    .select(
      'id, description, merchant_name, amount_yen, occurred_on, is_transfer, review_status, category_id',
    )
    .gte('occurred_on', monthStart)
    .lte('occurred_on', today)
    .lt('amount_yen', 0)
    .order('occurred_on', { ascending: false });
  if (error) throw new GenreStoreError(`明細を取得できませんでした: ${error.message}`);

  const countable = rows.filter((r) =>
    isCountable({
      categoryId: r.category_id,
      amountYen: r.amount_yen,
      isTransfer: r.is_transfer,
      reviewStatus: r.review_status,
    }),
  );
  const emptyView: GenreAnalysisView = { entries: [], pendingCount: 0 };
  if (countable.length === 0) return emptyView;
  const countableIds = countable.map((r) => r.id);

  const categoryIds = [
    ...new Set(countable.map((r) => r.category_id).filter((id): id is string => id !== null)),
  ];
  const categoryNameById = new Map<string, string>();
  if (categoryIds.length > 0) {
    const { data: categories, error: catError } = await supabase
      .from('categories')
      .select('id, name')
      .in('id', categoryIds);
    if (catError) throw new GenreStoreError(`カテゴリを取得できませんでした: ${catError.message}`);
    for (const c of categories) categoryNameById.set(c.id, c.name);
  }
  const categoryNameOf = (r: { category_id: string | null }): string | null =>
    r.category_id ? (categoryNameById.get(r.category_id) ?? null) : null;

  const { data: items, error: itemsError } = await supabase
    .from('receipt_items')
    .select('id, transaction_id, name, amount_yen')
    .in('transaction_id', countableIds);
  if (itemsError && !isMissingTableError(itemsError)) {
    throw new GenreStoreError(`品目を取得できませんでした: ${itemsError.message}`);
  }
  const itemsByTransaction = new Map<string, { id: string; amount_yen: number }[]>();
  for (const item of items ?? []) {
    const list = itemsByTransaction.get(item.transaction_id) ?? [];
    list.push(item);
    itemsByTransaction.set(item.transaction_id, list);
  }
  const allItems = [...itemsByTransaction.values()].flat();
  const transactionIdByItemId = new Map((items ?? []).map((i) => [i.id, i.transaction_id]));

  const { data: itemGenres, error: itemGenresError } = await supabase
    .from('receipt_item_genres')
    .select('receipt_item_id, genre_id')
    .in(
      'receipt_item_id',
      allItems.map((i) => i.id),
    );
  if (itemGenresError && !isMissingTableError(itemGenresError)) {
    throw new GenreStoreError(`ジャンル分類を取得できませんでした: ${itemGenresError.message}`);
  }

  const transactionById = new Map(countable.map((r) => [r.id, r]));
  const transactionsWithoutItems = countable.filter(
    (r) => (itemsByTransaction.get(r.id) ?? []).length === 0,
  );
  const { data: txGenres, error: txGenresError } = await supabase
    .from('transaction_genres')
    .select('transaction_id, genre_id')
    .in(
      'transaction_id',
      transactionsWithoutItems.map((r) => r.id),
    );
  if (txGenresError && !isMissingTableError(txGenresError)) {
    throw new GenreStoreError(`ジャンル分類を取得できませんでした: ${txGenresError.message}`);
  }

  const usedGenreIds = [
    ...new Set([
      ...(itemGenres ?? []).map((g) => g.genre_id),
      ...(txGenres ?? []).map((g) => g.genre_id),
    ]),
  ];
  const genreNameById = new Map<string, string>();
  if (usedGenreIds.length > 0) {
    const { data: genres, error: genresError } = await supabase
      .from('genres')
      .select('id, name')
      .in('id', usedGenreIds);
    if (genresError && !isMissingTableError(genresError)) {
      throw new GenreStoreError(`ジャンルを取得できませんでした: ${genresError.message}`);
    }
    for (const g of genres ?? []) genreNameById.set(g.id, g.name);
  }

  const entries: GenredEntry[] = [];
  for (const g of itemGenres ?? []) {
    const transactionId = transactionIdByItemId.get(g.receipt_item_id);
    const item = allItems.find((i) => i.id === g.receipt_item_id);
    const tx = transactionId ? transactionById.get(transactionId) : undefined;
    const genreName = genreNameById.get(g.genre_id);
    if (!item || !tx || genreName === undefined) continue;
    entries.push({
      genreId: g.genre_id,
      genreName,
      amountYen: item.amount_yen,
      categoryName: categoryNameOf(tx),
    });
  }
  const genredTransactionIds = new Set((txGenres ?? []).map((g) => g.transaction_id));
  for (const g of txGenres ?? []) {
    const tx = transactionById.get(g.transaction_id);
    const genreName = genreNameById.get(g.genre_id);
    if (!tx || genreName === undefined) continue;
    entries.push({
      genreId: g.genre_id,
      genreName,
      amountYen: Math.abs(tx.amount_yen),
      categoryName: categoryNameOf(tx),
    });
  }

  const genredItemIds = new Set((itemGenres ?? []).map((g) => g.receipt_item_id));
  const pendingItemCount = allItems.filter((i) => !genredItemIds.has(i.id)).length;
  const pendingTransactionCount = transactionsWithoutItems.filter(
    (r) => !genredTransactionIds.has(r.id),
  ).length;

  return { entries, pendingCount: pendingItemCount + pendingTransactionCount };
}

/**
 * 支出ジャンル(genres)のデータアクセス(本人発案、ADR-056/ADR-057)。
 *
 * ADR-057により、ジャンルは「AIが補助的に付ける客観タグ」から「唯一の
 * カテゴリ」に格上げされた。明細(transactions)・レシート品目(receipt_items)
 * それぞれが直接 `genre_id` 列を持つ(旧 categories.category_id と同じ形)。
 * 分類は本人の操作(CSV・メール取り込み等)では確定させず null のまま保存し、
 * 「今月、まだジャンル分類していない支出」を本人がボタンで一括AI分類する
 * (`transaction_diagnoses` と同じ「今月の未処理分だけを本人の操作で処理する」
 * 設計)か、明細を直接編集して手動で選び直す(本人の修正、ADR-057)。
 */

import { isCountable } from '@/domain/budget';
import type { GenredEntry } from '@/domain/genre';
import { sortQuickEntryGenres, type QuickEntryGenreInput } from '@/domain/quick-entry-genres';
import { addDays, monthStartJst, todayJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { isMissingColumnError, isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export class GenreStoreError extends AppError {}

/** 1回の「ジャンル分類する」呼び出しで処理する上限(品目・明細の合計)。
 * サーバーの実行時間に収めるためAIの1バッチ分(genre-ai.ts の DEFAULT_BATCH_SIZE)に
 * 合わせ、残りは呼び出し側が繰り返し呼んで処理する。 */
export const MAX_BATCH_SIZE = 40;

export type Genre = {
  id: string;
  name: string;
  sortOrder: number;
  /** 月次予算(本人発案「カテゴリのそれぞれの値段設定」)。未設定なら無制限。 */
  budgetYen: number | null;
  /** ホーム画面に残額を出すジャンルか(旧 categories.show_on_home、FR-14, FR-61)。 */
  showOnHome: boolean;
};

/** 選択肢としてだけ使う画面(取り込みプレビュー・明細編集等)向けの最小限の形。 */
export type GenreOption = Pick<Genre, 'id' | 'name'>;

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

function fromRow(row: {
  id: string;
  name: string;
  sort_order: number;
  budget_yen: number | null;
  show_on_home: boolean;
}): Genre {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    budgetYen: row.budget_yen,
    showOnHome: row.show_on_home,
  };
}

/** 使用頻度の集計対象にする期間(直近90日)。それより古い記録は今の傾向を表さない。 */
const QUICK_ENTRY_FREQUENCY_WINDOW_DAYS = 90;

/** ジャンル一覧(並び順)。1件も無ければ初期値を投入してから返す。 */
export async function listGenres(): Promise<Genre[]> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new GenreStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('genres')
    .select('id, name, sort_order, budget_yen, show_on_home')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new GenreStoreError(`ジャンルを取得できませんでした: ${error.message}`);
  }
  if (data.length > 0) return data.map(fromRow);

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
    .select('id, name, sort_order, budget_yen, show_on_home')
    .single();
  if (error) {
    if (isMissingTableError(error)) throw new GenreStoreError('ジャンル機能はまだ利用できません');
    if (error.code === '23505') throw new GenreStoreError('同じ名前のジャンルが既にあります');
    throw new GenreStoreError(`ジャンルを作成できませんでした: ${error.message}`);
  }
  return fromRow(data);
}

/** 月次予算(本人発案「カテゴリのそれぞれの値段設定」)を変更する。null は無制限。 */
export async function updateGenreBudget(id: string, budgetYen: number | null): Promise<void> {
  if (budgetYen !== null && (!Number.isInteger(budgetYen) || budgetYen < 0)) {
    throw new GenreStoreError('予算は0以上の整数円で指定してください');
  }
  const supabase = await createClient();
  const { error } = await supabase.from('genres').update({ budget_yen: budgetYen }).eq('id', id);
  if (error) throw new GenreStoreError(`予算を更新できませんでした: ${error.message}`);
}

/** ホーム画面に残額を出すか(旧 categories.show_on_home、FR-14, FR-61)。 */
export async function setGenreShowOnHome(id: string, showOnHome: boolean): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('genres').update({ show_on_home: showOnHome }).eq('id', id);
  if (error) throw new GenreStoreError(`更新できませんでした: ${error.message}`);
}

/**
 * ジャンルを削除する(本人発案「追加削除容易にしたい」、categories と違い
 * 統合を経由せず即座に削除できる)。使用中の明細・品目は genre_id が
 * on delete set null のため、削除すると自動的に「未分類」へ戻る
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

const SCAN_PAGE_SIZE = 500;
/** `.in()` は URL に載る上、Supabase は1回の応答を1000行までに切り詰めるため、
 * 品目の多いレシートでも収まるよう明細IDを少数ずつ取得する。 */
const ITEM_QUERY_ID_CHUNK = 20;

type ScanRange = { from?: string; to?: string };

/**
 * まだジャンル分類していない支出(収入・振替・対象外は除く、
 * domain/budget.ts の isCountable() と同じ定義)を新しい順に走査し、
 * limit 件までの分類対象を返す。レシート品目がある明細は品目ごとに、
 * 無い明細は明細全体を対象にする。
 */
async function scanUngenredTargets(range: ScanRange, limit: number): Promise<GenreTarget[]> {
  const supabase = await createClient();
  const targets: GenreTarget[] = [];

  for (let offset = 0; targets.length < limit; offset += SCAN_PAGE_SIZE) {
    let query = supabase
      .from('transactions')
      .select(
        'id, description, merchant_name, amount_yen, occurred_on, is_transfer, review_status, genre_id',
      )
      .lt('amount_yen', 0);
    if (range.from) query = query.gte('occurred_on', range.from);
    if (range.to) query = query.lte('occurred_on', range.to);
    const { data: rows, error } = await query
      .order('occurred_on', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + SCAN_PAGE_SIZE - 1);
    if (error) throw new GenreStoreError(`明細を取得できませんでした: ${error.message}`);
    if (rows.length === 0) break;

    const countable = rows.filter((r) =>
      isCountable({
        categoryId: r.genre_id,
        amountYen: r.amount_yen,
        isTransfer: r.is_transfer,
        reviewStatus: r.review_status,
      }),
    );

    const items: {
      id: string;
      transaction_id: string;
      name: string;
      amount_yen: number;
      genre_id: string | null;
    }[] = [];
    for (let i = 0; i < countable.length; i += ITEM_QUERY_ID_CHUNK) {
      const ids = countable.slice(i, i + ITEM_QUERY_ID_CHUNK).map((r) => r.id);
      const { data, error: itemsError } = await supabase
        .from('receipt_items')
        .select('id, transaction_id, name, amount_yen, genre_id')
        .in('transaction_id', ids);
      if (itemsError && !isMissingTableError(itemsError)) {
        throw new GenreStoreError(`品目を取得できませんでした: ${itemsError.message}`);
      }
      items.push(...(data ?? []));
    }
    const itemTransactionIds = new Set(items.map((i) => i.transaction_id));

    for (const item of items.filter((i) => i.genre_id === null)) {
      targets.push({ kind: 'item', id: item.id, label: item.name, amountYen: item.amount_yen });
    }
    for (const tx of countable) {
      if (itemTransactionIds.has(tx.id)) continue; // 品目側で分類する
      if (tx.genre_id !== null) continue;
      targets.push({
        kind: 'transaction',
        id: tx.id,
        label: tx.merchant_name ?? tx.description,
        amountYen: Math.abs(tx.amount_yen),
      });
    }

    if (rows.length < SCAN_PAGE_SIZE) break;
  }

  return targets.slice(0, limit);
}

/** 今月、まだジャンル分類していない支出(1回の処理上限つき)。 */
export async function listUngenredSpendTargets(now: Date = new Date()): Promise<GenreTarget[]> {
  return scanUngenredTargets({ from: monthStartJst(0, now), to: todayJst(now) }, MAX_BATCH_SIZE);
}

/** 期間を問わず、まだジャンル分類していない支出(1回の処理上限つき)。 */
export async function listUngenredSpendTargetsAllPeriods(): Promise<GenreTarget[]> {
  return scanUngenredTargets({}, MAX_BATCH_SIZE);
}

/** 期間を問わず、まだジャンル分類していない品目・明細の件数。 */
export async function countUngenredSpendTargetsAllPeriods(): Promise<number> {
  return (await scanUngenredTargets({}, Number.POSITIVE_INFINITY)).length;
}

/** ジャンル分類の結果を保存する。品目と明細で更新先テーブルが違うため分けて実行する。 */
export async function saveGenres(
  results: readonly {
    kind: 'item' | 'transaction';
    id: string;
    genreId: string;
    confidence: number;
  }[],
): Promise<void> {
  if (results.length === 0) return;

  const supabase = await createClient();

  for (const r of results.filter((r) => r.kind === 'item')) {
    const { error } = await supabase
      .from('receipt_items')
      .update({ genre_id: r.genreId })
      .eq('id', r.id);
    if (error) throw new GenreStoreError(`品目のジャンルを保存できませんでした: ${error.message}`);
  }

  for (const r of results.filter((r) => r.kind === 'transaction')) {
    const { error } = await supabase
      .from('transactions')
      .update({ genre_id: r.genreId, classified_by: 'ai', confidence: r.confidence })
      .eq('id', r.id);
    if (error) throw new GenreStoreError(`明細のジャンルを保存できませんでした: ${error.message}`);
  }
}

export type GenreAnalysisView = {
  entries: readonly GenredEntry[];
  /** 今月、まだジャンル分類していない品目・明細の件数。0 ならボタンは不要。 */
  pendingCount: number;
};

/**
 * 「ジャンル別分析」画面向けのビュー(本人発案)。今月分の、明細全体・
 * レシート品目それぞれのジャンルと「絶対払わざるを得ないもの」ラベルを
 * まとめて返す。集計そのものは domain/genre.ts の summarizeByGenre()/
 * summarizeMustPaySplit() が担う(ここではDBから素材を集めるだけ)。
 *
 * 品目(ADR-035)は明細本体とは別に自分のジャンルを持てるが、must_pay は
 * 明細1件ごとのラベル(ADR-057)のため、品目は親である明細の must_pay を
 * そのまま引き継ぐ。
 */
export async function loadGenreAnalysisView(now: Date = new Date()): Promise<GenreAnalysisView> {
  const supabase = await createClient();
  const monthStart = monthStartJst(0, now);
  const today = todayJst(now);

  const { data: rows, error } = await supabase
    .from('transactions')
    .select(
      'id, description, merchant_name, amount_yen, occurred_on, is_transfer, review_status, genre_id, must_pay',
    )
    .gte('occurred_on', monthStart)
    .lte('occurred_on', today)
    .lt('amount_yen', 0)
    .order('occurred_on', { ascending: false });
  if (error) throw new GenreStoreError(`明細を取得できませんでした: ${error.message}`);

  const countable = rows.filter((r) =>
    isCountable({
      categoryId: r.genre_id,
      amountYen: r.amount_yen,
      isTransfer: r.is_transfer,
      reviewStatus: r.review_status,
    }),
  );
  const emptyView: GenreAnalysisView = { entries: [], pendingCount: 0 };
  if (countable.length === 0) return emptyView;
  const countableIds = countable.map((r) => r.id);

  const { data: items, error: itemsError } = await supabase
    .from('receipt_items')
    .select('id, transaction_id, amount_yen, genre_id')
    .in('transaction_id', countableIds);
  if (itemsError && !isMissingTableError(itemsError)) {
    throw new GenreStoreError(`品目を取得できませんでした: ${itemsError.message}`);
  }
  const itemsByTransaction = new Map<
    string,
    { id: string; amount_yen: number; genre_id: string | null }[]
  >();
  for (const item of items ?? []) {
    const list = itemsByTransaction.get(item.transaction_id) ?? [];
    list.push(item);
    itemsByTransaction.set(item.transaction_id, list);
  }

  const genreIds = new Set<string>();
  for (const tx of countable) if (tx.genre_id) genreIds.add(tx.genre_id);
  for (const item of items ?? []) if (item.genre_id) genreIds.add(item.genre_id);

  const genreNameById = new Map<string, string>();
  if (genreIds.size > 0) {
    const { data: genres, error: genresError } = await supabase
      .from('genres')
      .select('id, name')
      .in('id', [...genreIds]);
    if (genresError)
      throw new GenreStoreError(`ジャンルを取得できませんでした: ${genresError.message}`);
    for (const g of genres) genreNameById.set(g.id, g.name);
  }

  const entries: GenredEntry[] = [];
  let pendingCount = 0;

  for (const tx of countable) {
    const items = itemsByTransaction.get(tx.id) ?? [];
    if (items.length > 0) {
      for (const item of items) {
        if (item.genre_id === null) {
          pendingCount += 1;
          continue;
        }
        const genreName = genreNameById.get(item.genre_id);
        if (genreName === undefined) continue;
        entries.push({
          genreId: item.genre_id,
          genreName,
          amountYen: item.amount_yen,
          mustPay: tx.must_pay,
        });
      }
      continue;
    }
    if (tx.genre_id === null) {
      pendingCount += 1;
      continue;
    }
    const genreName = genreNameById.get(tx.genre_id);
    if (genreName === undefined) continue;
    entries.push({
      genreId: tx.genre_id,
      genreName,
      amountYen: Math.abs(tx.amount_yen),
      mustPay: tx.must_pay,
    });
  }

  return { entries, pendingCount };
}

export type QuickEntryGenre = { id: string; name: string };
export type QuickEntryGenreSetting = QuickEntryGenre & {
  hiddenInQuickEntry: boolean;
};

async function computeQuickEntryInputs(now: Date): Promise<QuickEntryGenreInput[]> {
  const supabase = await createClient();

  let { data: genres, error } = await supabase
    .from('genres')
    .select('id, name, quick_entry_order, hidden_in_quick_entry');
  // quick_entry_order・hidden_in_quick_entry が本番に未適用のあいだは、
  // その2列を外して再取得する(ADR-033。並び順は頻度順、非表示は無しとして扱う)。
  if (error && isMissingColumnError(error)) {
    const retry = await supabase.from('genres').select('id, name');
    genres =
      retry.data?.map((g) => ({ ...g, quick_entry_order: null, hidden_in_quick_entry: false })) ??
      null;
    error = retry.error;
  }
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new GenreStoreError(`ジャンルを取得できませんでした: ${error.message}`);
  }
  if (genres === null) return [];

  const since = addDays(todayJst(now), -QUICK_ENTRY_FREQUENCY_WINDOW_DAYS);
  const { data: recent, error: recentError } = await supabase
    .from('transactions')
    .select('genre_id')
    .not('genre_id', 'is', null)
    .gte('occurred_on', since)
    .lte('occurred_on', todayJst(now));
  if (recentError)
    throw new GenreStoreError(`使用頻度を集計できませんでした: ${recentError.message}`);

  const usageCountByGenreId = new Map<string, number>();
  for (const row of recent ?? []) {
    if (row.genre_id === null) continue;
    usageCountByGenreId.set(row.genre_id, (usageCountByGenreId.get(row.genre_id) ?? 0) + 1);
  }

  return genres.map((g) => ({
    id: g.id,
    name: g.name,
    quickEntryOrder: g.quick_entry_order,
    hiddenInQuickEntry: g.hidden_in_quick_entry,
    usageCount: usageCountByGenreId.get(g.id) ?? 0,
  }));
}

/**
 * 手入力のカテゴリ格子(N2)に出すジャンル一覧。既定は直近90日の使用頻度順、
 * 長押しで手動並べ替え済み(quick_entry_order が入っている)のジャンルは
 * その順を優先する。hidden_in_quick_entry のジャンルは含めない
 * (domain/quick-entry-genres.ts の sortQuickEntryGenres が実際の並び替えを行う)。
 */
export async function fetchQuickEntryGenres(now: Date = new Date()): Promise<QuickEntryGenre[]> {
  const inputs = await computeQuickEntryInputs(now);
  return sortQuickEntryGenres(inputs).map((g) => ({ id: g.id, name: g.name }));
}

/**
 * 格子の管理シート向け(N2「長押しで手動の並べ替えと非表示」)。非表示中の
 * ジャンルも含め、現在の並び順のまま全件返す(解除・並べ替えの対象にするため)。
 */
export async function fetchQuickEntryGenreSettings(
  now: Date = new Date(),
): Promise<QuickEntryGenreSetting[]> {
  const inputs = await computeQuickEntryInputs(now);
  const visible = sortQuickEntryGenres(inputs.filter((g) => !g.hiddenInQuickEntry));
  const hidden = inputs
    .filter((g) => g.hiddenInQuickEntry)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return [...visible, ...hidden].map((g) => ({
    id: g.id,
    name: g.name,
    hiddenInQuickEntry: g.hiddenInQuickEntry,
  }));
}

/**
 * 長押しの並べ替え。渡した順に quick_entry_order を振り直す(以後、
 * これらのジャンルは頻度ではなくこの順で並ぶ)。
 */
export async function reorderQuickEntryGenres(orderedIds: readonly string[]): Promise<void> {
  const supabase = await createClient();
  for (const [index, id] of orderedIds.entries()) {
    const { error } = await supabase
      .from('genres')
      .update({ quick_entry_order: (index + 1) * 10 })
      .eq('id', id);
    if (error) throw new GenreStoreError(`並び順を保存できませんでした: ${error.message}`);
  }
}

/** 長押しの「非表示にする/戻す」。ジャンル自体は残り、他の画面には影響しない。 */
export async function setGenreQuickEntryHidden(id: string, hidden: boolean): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('genres')
    .update({ hidden_in_quick_entry: hidden })
    .eq('id', id);
  if (error) throw new GenreStoreError(`表示設定を保存できませんでした: ${error.message}`);
}

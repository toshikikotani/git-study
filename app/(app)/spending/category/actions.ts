'use server';

/**
 * カテゴリ詳細の Server Action(P6・P7)。
 *
 * カテゴリの移動は domain/category-move.ts の計画(planCategoryMove / planItemMove)を使う。
 * 画面の楽観的更新と同じ計画なので、サーバーで保存した結果と画面の見た目がずれない。
 * どの操作も、変更前の値(MovePrevious)を返し、元に戻す(restoreMovesAction)で書き戻せる。
 */

import { revalidatePath } from 'next/cache';

import { confirmFixedCost, unconfirmFixedCost } from '@/features/subscriptions/fixed-cost-store';

import {
  MovePlanError,
  applyPlanToInput,
  planCategoryMove,
  planItemMove,
  planWholeMove,
  splitsAreConsistent,
  type MoveInput,
  type MovePlan,
} from '@/domain/category-move';
import { comparableKey } from '@/domain/store-name';
import {
  findRuleMatches,
  storeKeyOf,
  type RuleCandidate,
  type RuleScope,
} from '@/domain/rule-match';
import {
  deleteRule,
  listRulesForGenre,
  saveStoreRule,
  updateRuleGenre,
} from '@/features/genre/memory-store';
import { recordCorrection } from '@/features/genre/memory-store';
import { deletePromise, savePromise } from '@/features/forecast/promise-store';
import { promiseAmountsFor } from '@/features/forecast/what-if';
import { listGenres, setGenreForecastClosed, updateGenreBudget } from '@/features/genre/store';
import { renameGenre, saveGenreStyle } from '@/features/genre/style-store';
import { replaceSplits } from '@/features/transactions/splits-store';
import { describeUserError } from '@/lib/errors';
import { monthStartJst, todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

/** 移す前の状態(Undo 用)。 */
export type MovePrevious = {
  id: string;
  genreId: string | null;
  classifiedBy: 'unclassified' | 'rule' | 'ai' | 'manual';
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
  reviewedAt: string | null;
  splits: { genreId: string | null; amountYen: number; note: string | null }[];
  itemGenres: { id: string; genreId: string | null }[];
};

type Client = Awaited<ReturnType<typeof createClient>>;

async function loadState(
  supabase: Client,
  id: string,
): Promise<{ input: MoveInput; previous: MovePrevious } | null> {
  const [tx, splits, items] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, amount_yen, genre_id, classified_by, review_status, reviewed_at')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('transaction_splits')
      .select('genre_id, amount_yen, note')
      .eq('transaction_id', id),
    supabase
      .from('receipt_items')
      .select('id, name, amount_yen, genre_id')
      .eq('transaction_id', id)
      .order('sort_order'),
  ]);
  if (!tx.data) return null;
  const splitRows = (splits.data ?? []).map((s) => ({
    genreId: s.genre_id,
    amountYen: s.amount_yen,
    note: s.note,
  }));
  const itemRows = (items.data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    amountYen: i.amount_yen,
    genreId: i.genre_id,
  }));
  return {
    input: {
      amountYen: tx.data.amount_yen,
      genreId: tx.data.genre_id,
      splits: splitRows,
      items: itemRows,
    },
    previous: {
      id,
      genreId: tx.data.genre_id,
      classifiedBy: tx.data.classified_by,
      reviewStatus: tx.data.review_status,
      reviewedAt: tx.data.reviewed_at,
      splits: splitRows,
      itemGenres: itemRows.map((i) => ({ id: i.id, genreId: i.genreId })),
    },
  };
}

async function applyPlan(supabase: Client, id: string, plan: MovePlan, hadSplits: boolean) {
  const { error } = await supabase
    .from('transactions')
    .update({
      genre_id: plan.genreId,
      classified_by: 'manual',
      review_status: 'corrected',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error('カテゴリを移せませんでした。');
  if (hadSplits || plan.splits.length > 0) await replaceSplits(id, plan.splits);
  for (const [itemId, genreId] of plan.itemGenres) {
    const { error: itemError } = await supabase
      .from('receipt_items')
      .update({ genre_id: genreId })
      .eq('id', itemId);
    if (itemError) throw new Error('品目のカテゴリを移せませんでした。');
  }
}

async function restoreOne(supabase: Client, p: MovePrevious): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({
      genre_id: p.genreId,
      classified_by: p.classifiedBy,
      review_status: p.reviewStatus,
      reviewed_at: p.reviewedAt,
    })
    .eq('id', p.id);
  if (error) throw new Error('元に戻せませんでした。');
  await replaceSplits(p.id, p.splits);
  for (const item of p.itemGenres) {
    await supabase.from('receipt_items').update({ genre_id: item.genreId }).eq('id', item.id);
  }
}

export type MoveResult = { error: string | null; previous?: MovePrevious[] };

/**
 * 明細(の、fromGenreId に属する部分)を toGenreId へ移す。複数件をまとめて移せる(一括修正)。
 * 途中で失敗したら、すでに移した分を元に戻してエラーを返す(半分だけ移った状態を残さない)。
 */
export async function moveTransactionsAction(input: {
  ids: readonly string[];
  fromGenreId: string | null;
  toGenreId: string | null;
}): Promise<MoveResult> {
  if (input.ids.length === 0) return { error: null, previous: [] };
  const supabase = await createClient();
  const done: MovePrevious[] = [];
  try {
    for (const id of input.ids) {
      const state = await loadState(supabase, id);
      if (state === null) throw new Error('明細が見つかりません。');
      const plan = planCategoryMove(state.input, input.fromGenreId, input.toGenreId);
      if (!splitsAreConsistent(state.input.amountYen, plan)) {
        throw new Error('分割の合計が金額と合わないため、移せません。');
      }
      await applyPlan(supabase, id, plan, state.input.splits.length > 0);
      done.push(state.previous);
    }
  } catch (e) {
    for (const p of done.reverse()) {
      try {
        await restoreOne(supabase, p);
      } catch {
        // 戻せなかった分は、そのまま(エラーで知らせる)
      }
    }
    return { error: describeUserError(e, 'カテゴリを移せませんでした。') };
  }
  revalidatePath('/spending');
  revalidatePath('/plan');
  return { error: null, previous: done };
}

/** 分割したレシートの品目1つだけを別のカテゴリへ移し、分割の内訳を更新する。 */
export async function moveItemAction(input: {
  transactionId: string;
  itemId: string;
  toGenreId: string | null;
}): Promise<MoveResult> {
  const supabase = await createClient();
  try {
    const state = await loadState(supabase, input.transactionId);
    if (state === null) throw new Error('明細が見つかりません。');
    const plan = planItemMove(state.input, input.itemId, input.toGenreId);
    if (!splitsAreConsistent(state.input.amountYen, plan)) {
      throw new Error('分割の合計が金額と合わないため、移せません。');
    }
    await applyPlan(supabase, input.transactionId, plan, true);
    revalidatePath('/spending');
    revalidatePath('/plan');
    return { error: null, previous: [state.previous] };
  } catch (e) {
    if (e instanceof MovePlanError) return { error: e.message };
    return { error: describeUserError(e, '品目を移せませんでした。') };
  }
}

/** 移動の Undo。移す前の状態(ジャンル・分割・品目のジャンル)を書き戻す。 */
export async function restoreMovesAction(
  previous: readonly MovePrevious[],
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  try {
    for (const p of previous) await restoreOne(supabase, p);
  } catch (e) {
    return { error: describeUserError(e, '元に戻せませんでした。') };
  }
  revalidatePath('/spending');
  revalidatePath('/plan');
  return { error: null };
}

export type FieldsPrevious = {
  id: string;
  amountYen?: number;
  occurredOn?: string;
  merchantName?: string | null;
  note?: string | null;
};

/**
 * 金額・日付・店名・メモを直す(編集シート)。直した項目の変更前の値を返し、
 * restoreFieldsAction で書き戻せる。金額は、分割したレシートでは変えられない
 * (分割の合計と合わなくなるため)。
 */
export async function updateFieldsAction(
  id: string,
  patch: { amountYen?: number; occurredOn?: string; merchantName?: string; note?: string | null },
): Promise<{ error: string | null; previous?: FieldsPrevious }> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from('transactions')
    .select('amount_yen, occurred_on, merchant_name, note')
    .eq('id', id)
    .maybeSingle();
  if (!row) return { error: '明細が見つかりません。' };

  const update: {
    amount_yen?: number;
    occurred_on?: string;
    merchant_name?: string;
    note?: string | null;
  } = {};
  const previous: FieldsPrevious = { id };
  if (patch.amountYen !== undefined) {
    if (!Number.isInteger(patch.amountYen) || patch.amountYen === 0) {
      return { error: '金額は0以外の整数で入力してください。' };
    }
    const { count } = await supabase
      .from('transaction_splits')
      .select('id', { count: 'exact', head: true })
      .eq('transaction_id', id);
    if ((count ?? 0) > 0) {
      return { error: '分割したレシートの金額は、分割を解除してから直してください。' };
    }
    update.amount_yen = patch.amountYen;
    previous.amountYen = row.amount_yen;
  }
  if (patch.occurredOn !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.occurredOn)) return { error: '日付が正しくありません。' };
    update.occurred_on = patch.occurredOn;
    previous.occurredOn = row.occurred_on;
  }
  if (patch.merchantName !== undefined) {
    const name = patch.merchantName.trim();
    if (name === '') return { error: '店名を入力してください。' };
    update.merchant_name = name;
    previous.merchantName = row.merchant_name;
  }
  if (patch.note !== undefined) {
    const note = patch.note?.trim() ?? '';
    update.note = note === '' ? null : note;
    previous.note = row.note;
  }
  if (Object.keys(update).length === 0) return { error: null, previous };
  const { error } = await supabase.from('transactions').update(update).eq('id', id);
  if (error) return { error: '保存できませんでした。' };
  revalidatePath('/spending');
  revalidatePath('/plan');
  return { error: null, previous };
}

export async function restoreFieldsAction(
  previous: FieldsPrevious,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (previous.amountYen !== undefined) update.amount_yen = previous.amountYen;
  if (previous.occurredOn !== undefined) update.occurred_on = previous.occurredOn;
  if (previous.merchantName !== undefined) update.merchant_name = previous.merchantName;
  if (previous.note !== undefined) update.note = previous.note;
  const { error } = await supabase
    .from('transactions')
    .update(update as never)
    .eq('id', previous.id);
  if (error) return { error: '元に戻せませんでした。' };
  revalidatePath('/spending');
  revalidatePath('/plan');
  return { error: null };
}

// ---- 分類ルール(P7・P8)-------------------------------------------------------------------

export type RuleMatchRow = {
  id: string;
  occurredOn: string;
  label: string;
  amountYen: number;
  genreId: string | null;
  genreName: string | null;
};

/** ルールの対象になりうる過去の取引(店で絞り、品目のルールは品目を読んで確かめる)。 */
async function loadRuleCandidates(
  supabase: Client,
  scope: RuleScope,
): Promise<{ candidates: RuleCandidate[]; genreNames: Map<string, string> }> {
  const [{ data: txs }, { data: genres }] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, occurred_on, description, merchant_name, amount_yen, genre_id')
      .lt('amount_yen', 0)
      .order('occurred_on', { ascending: false })
      .limit(5000),
    supabase.from('genres').select('id, name'),
  ]);
  const storeKey = storeKeyOf(scope.storeName);
  const inStore = (txs ?? []).filter(
    (t) => storeKeyOf(t.merchant_name ?? t.description) === storeKey && storeKey !== '',
  );
  const itemsByTx = new Map<string, string[]>();
  if (scope.kind === 'item' && inStore.length > 0) {
    const ids = inStore.map((t) => t.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data: items } = await supabase
        .from('receipt_items')
        .select('transaction_id, name')
        .in('transaction_id', ids.slice(i, i + 200));
      for (const it of items ?? []) {
        const list = itemsByTx.get(it.transaction_id) ?? [];
        list.push(it.name);
        itemsByTx.set(it.transaction_id, list);
      }
    }
  }
  return {
    candidates: inStore.map((t) => ({
      id: t.id,
      occurredOn: t.occurred_on,
      label: t.merchant_name ?? t.description,
      amountYen: t.amount_yen,
      genreId: t.genre_id,
      itemNames: itemsByTx.get(t.id) ?? [],
    })),
    genreNames: new Map((genres ?? []).map((g) => [g.id, g.name])),
  };
}

/** ルールを保存する前の事前確認:一致する過去の取引の件数と一覧。 */
export async function previewRuleAction(input: {
  scope: RuleScope;
  toGenreId: string;
}): Promise<{ error: string | null; matches: RuleMatchRow[] }> {
  try {
    const supabase = await createClient();
    const { candidates, genreNames } = await loadRuleCandidates(supabase, input.scope);
    const matches = findRuleMatches(input.scope, input.toGenreId, candidates).map((c) => ({
      id: c.id,
      occurredOn: c.occurredOn,
      label: c.label,
      amountYen: c.amountYen,
      genreId: c.genreId,
      genreName: c.genreId === null ? null : (genreNames.get(c.genreId) ?? null),
    }));
    return { error: null, matches };
  } catch (e) {
    return { error: describeUserError(e, '一致する取引を調べられませんでした。'), matches: [] };
  }
}

export type SaveRuleResult = {
  error: string | null;
  /** 過去に当てた件数。 */
  applied: number;
  previous?: MovePrevious[];
};

/**
 * ルールを保存する。applyToPast なら、一致する過去の取引にも当てる(移す前の状態を返し、Undo できる)。
 * 一致する取引は、クライアントの値を信じず、サーバーで探し直す。
 */
export async function saveRuleAction(input: {
  scope: RuleScope;
  toGenreId: string;
  applyToPast: boolean;
}): Promise<SaveRuleResult> {
  const supabase = await createClient();
  try {
    if (input.scope.kind === 'store') {
      await saveStoreRule(input.scope.storeName, input.toGenreId);
    } else {
      await recordCorrection({
        storeName: input.scope.storeName,
        itemName: input.scope.itemName,
        genreId: input.toGenreId,
        pin: true,
      });
    }
  } catch (e) {
    return { error: describeUserError(e, 'ルールを保存できませんでした。'), applied: 0 };
  }
  if (!input.applyToPast) {
    revalidatePath('/spending');
    return { error: null, applied: 0 };
  }

  const done: MovePrevious[] = [];
  try {
    const { candidates } = await loadRuleCandidates(supabase, input.scope);
    const matches = findRuleMatches(input.scope, input.toGenreId, candidates);
    for (const m of matches) {
      const state = await loadState(supabase, m.id);
      if (state === null) continue;
      let plan: MovePlan;
      if (input.scope.kind === 'store') {
        plan = planWholeMove(state.input, input.toGenreId);
      } else {
        // 一致する品目を、1つずつ移す(続けて計画を作る)。
        const key = comparableKey(input.scope.itemName);
        let current = state.input;
        const itemGenres = new Map<string, string | null>();
        let last: MovePlan | null = null;
        for (const item of state.input.items) {
          if (comparableKey(item.name) !== key) continue;
          last = planItemMove(current, item.id, input.toGenreId);
          current = applyPlanToInput(current, last);
          for (const [k, v] of last.itemGenres) itemGenres.set(k, v);
        }
        if (last === null) continue;
        plan = { genreId: last.genreId, splits: last.splits, itemGenres };
      }
      if (!splitsAreConsistent(state.input.amountYen, plan)) continue;
      await applyPlan(supabase, m.id, plan, state.input.splits.length > 0);
      done.push(state.previous);
    }
  } catch (e) {
    for (const p of done.reverse()) {
      try {
        await restoreOne(supabase, p);
      } catch {
        // 戻せなかった分は、そのまま
      }
    }
    return { error: describeUserError(e, '過去の取引に当てられませんでした。'), applied: 0 };
  }
  revalidatePath('/spending');
  revalidatePath('/plan');
  return { error: null, applied: done.length, previous: done };
}

/** ルールの Undo(保存したルールを消す。過去に当てた分は restoreMovesAction で戻す)。 */
export async function undoRuleAction(input: {
  scope: RuleScope;
  previous?: MovePrevious[];
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  try {
    if (input.previous && input.previous.length > 0) {
      for (const p of input.previous) await restoreOne(supabase, p);
    }
    const storeKey = comparableKey(input.scope.storeName);
    const itemKey = input.scope.kind === 'store' ? '*' : comparableKey(input.scope.itemName);
    const { data } = await supabase
      .from('genre_memory')
      .select('id')
      .eq('store_key', storeKey)
      .eq('item_key', itemKey)
      .maybeSingle();
    if (data) await deleteRule(data.id);
  } catch (e) {
    return { error: describeUserError(e, '元に戻せませんでした。') };
  }
  revalidatePath('/spending');
  revalidatePath('/plan');
  return { error: null };
}

/** このカテゴリに固定されているルール(P8 の管理画面用)。 */
export async function listRulesAction(genreId: string): Promise<{
  error: string | null;
  rules: { id: string; storeKey: string; itemKey: string; hits: number }[];
}> {
  try {
    const rules = await listRulesForGenre(genreId);
    return {
      error: null,
      rules: rules.map((r) => ({
        id: r.id,
        storeKey: r.storeKey,
        itemKey: r.itemKey,
        hits: r.hits,
      })),
    };
  } catch (e) {
    return { error: describeUserError(e, 'ルールを取得できませんでした。'), rules: [] };
  }
}

export async function deleteRuleAction(id: string): Promise<{ error: string | null }> {
  try {
    await deleteRule(id);
  } catch (e) {
    return { error: describeUserError(e, 'ルールを削除できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

export async function updateRuleGenreAction(
  id: string,
  genreId: string,
): Promise<{ error: string | null }> {
  try {
    await updateRuleGenre(id, genreId);
  } catch (e) {
    return { error: describeUserError(e, 'ルールを変更できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

/** P8: カテゴリ名を変える(同名は不可)。 */
export async function renameCategoryAction(
  genreId: string,
  name: string,
): Promise<{ error: string | null }> {
  try {
    await renameGenre(genreId, name);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

/** P8: アイコンと色を変える(色は、コントラストを満たす候補だけ)。 */
export async function saveCategoryStyleAction(
  genreId: string,
  style: { icon: string; colorIndex: number },
): Promise<{ error: string | null }> {
  try {
    await saveGenreStyle(genreId, style);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

/** P8: 目標が無いときの月の目安(ジャンルの予算)を変える。空は「なし」。 */
export async function updateCategoryBudgetAction(
  genreId: string,
  budgetYen: number | null,
): Promise<{ error: string | null }> {
  try {
    await updateGenreBudget(genreId, budgetYen);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

export async function setCategoryForecastClosedAction(
  genreId: string,
  closed: boolean,
): Promise<{ error: string | null }> {
  try {
    await setGenreForecastClosed(genreId, closed);
  } catch (error) {
    return { error: error instanceof Error ? error.message : '予測の停止を保存できませんでした' };
  }
  return { error: null };
}

/** カテゴリを固定費にする。固定費は予測を止めるのが必須。 */
export async function setCategoryFixedAction(
  genreId: string,
  fixed: boolean,
): Promise<{ error: string | null }> {
  try {
    if (fixed) {
      await confirmFixedCost(`genre:${genreId}`);
      await setGenreForecastClosed(genreId, true);
    } else {
      await unconfirmFixedCost(`genre:${genreId}`);
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '固定費を保存できませんでした' };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

/**
 * ジャンルの約束を決める・変える・やめる(「もし、へらしたら」の「決める」、ADR-075)。
 * perWeek が null ならやめる(いつも通りに戻す)。見込みの額はサーバーで予測から出し直す
 * (画面から送られた数字は使わない)。
 */
export async function decideCategoryPromiseAction(
  genreId: string,
  perWeek: number | null,
): Promise<{ error: string | null }> {
  const month = monthStartJst();
  try {
    if (perWeek === null) {
      await deletePromise(genreId, month);
    } else {
      // 0 は「これ以上は使わない」(ADR-078)。
      if (!Number.isInteger(perWeek) || perWeek < 0 || perWeek > 7) {
        return { error: '回数を選び直してください' };
      }
      const genre = (await listGenres()).find((g) => g.id === genreId);
      if (genre === undefined) return { error: 'ジャンルが見つかりませんでした' };
      const amounts = await promiseAmountsFor({
        genreId,
        genreName: genre.name,
        genreBudgetYen: genre.budgetYen,
        perWeek,
      });
      if (amounts === null) {
        return { error: 'このジャンルは、今は約束の見込みを出せません' };
      }
      await savePromise({
        genreId,
        month,
        perWeek,
        promisedOn: todayJst(),
        usualYen: amounts.usualYen,
        limitYen: amounts.limitYen,
      });
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '約束を保存できませんでした' };
  }
  // 約束は全画面の見込みに入るので、ホーム・レポート・家計簿も出し直す。
  revalidatePath('/', 'layout');
  return { error: null };
}

'use server';

/**
 * カテゴリ詳細の Server Action(P6・P7)。
 *
 * カテゴリの移動は domain/category-move.ts の計画(planCategoryMove / planItemMove)を使う。
 * 画面の楽観的更新と同じ計画なので、サーバーで保存した結果と画面の見た目がずれない。
 * どの操作も、変更前の値(MovePrevious)を返し、元に戻す(restoreMovesAction)で書き戻せる。
 */

import { revalidatePath } from 'next/cache';

import {
  MovePlanError,
  planCategoryMove,
  planItemMove,
  splitsAreConsistent,
  type MoveInput,
  type MovePlan,
} from '@/domain/category-move';
import { replaceSplits } from '@/features/transactions/splits-store';
import { describeUserError } from '@/lib/errors';
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

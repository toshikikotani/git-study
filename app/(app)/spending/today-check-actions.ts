'use server';

/**
 * 今日の答え合わせ(v4-1、ADR-129)の Server Action。読み書きの本体は features/today-check/store.ts
 * (LINE・夜の配信と同じもの)。どちらで片づけても「確認が必要」・明細にすぐ映るよう、画面を出し直す。
 */

import { revalidatePath } from 'next/cache';

import { todayNumbersOf } from '@/features/advisor/context';
import { loadTodayForecasts } from '@/features/home/today-forecasts';
import {
  applyTodayCheck,
  listTodayCheck,
  undoTodayCheck,
  type CheckAction,
  type CheckUndo,
  type TodayCheckItem,
} from '@/features/today-check/store';
import { splitMergedPayment } from '@/features/transactions/payment-merge';
import { todayJst } from '@/lib/date';
import { describeUserError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

async function owner() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('ログイン状態を確認できませんでした。');
  return { supabase, userId: data.user.id };
}

function refresh() {
  revalidatePath('/');
  revalidatePath('/spending');
  revalidatePath('/spending/review');
}

export async function listTodayCheckAction(): Promise<{
  items: TodayCheckItem[];
  error: string | null;
}> {
  try {
    const { supabase, userId } = await owner();
    return { items: await listTodayCheck(supabase, userId, todayJst()), error: null };
  } catch (error) {
    return { items: [], error: describeUserError(error, '答え合わせの記録を読めませんでした。') };
  }
}

export async function applyTodayCheckAction(input: {
  id: string;
  action: CheckAction;
  genreId?: string | null;
}): Promise<{ undo: CheckUndo | null; error: string | null }> {
  try {
    const { supabase, userId } = await owner();
    const undo = await applyTodayCheck(supabase, userId, input);
    refresh();
    return { undo, error: null };
  } catch (error) {
    return { undo: null, error: describeUserError(error, '保存できませんでした。') };
  }
}

export async function undoTodayCheckAction(undo: CheckUndo): Promise<{ error: string | null }> {
  try {
    const { supabase, userId } = await owner();
    await undoTodayCheck(supabase, userId, undo);
    refresh();
    return { error: null };
  } catch (error) {
    return { error: describeUserError(error, '元に戻せませんでした。') };
  }
}

/** 自動で1件にまとめた記録を、レシートと支払いの2件に分け直す。 */
export async function splitMergedPaymentAction(id: string): Promise<{ error: string | null }> {
  try {
    const { supabase, userId } = await owner();
    await splitMergedPayment(supabase, userId, id);
    refresh();
    return { error: null };
  } catch (error) {
    return { error: describeUserError(error, '分けられませんでした。') };
  }
}

/** 終わったときに出す、今日の支出と明日からの目安(今日の画面と同じ予測)。 */
export async function todayCheckSummaryAction(): Promise<{
  spentTodayYen: number | null;
  tomorrowYen: number | null;
}> {
  try {
    const now = new Date();
    const forecasts = await loadTodayForecasts(now);
    const view = forecasts.goalView ?? forecasts.monthView;
    const numbers = todayNumbersOf(forecasts, now);
    return {
      spentTodayYen: numbers.allowance?.spentYen ?? view?.todaySpentYen ?? null,
      tomorrowYen: forecasts.goalView?.tomorrowLimit?.todayLimitYen ?? null,
    };
  } catch {
    return { spentTodayYen: null, tomorrowYen: null };
  }
}

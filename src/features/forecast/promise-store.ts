/**
 * ジャンルの約束(「外食を週1回へらす」、ADR-075)の読み書き(サーバー)。
 *
 * 表(spending_promises)がまだ本番に無いあいだは、読み取りは「約束なし」、書き込みは
 * 機能名つきのエラーにする(ADR-033 と同じ扱い)。
 */

import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import type { DateOnly } from '@/lib/date';

export type SpendingPromise = {
  genreId: string;
  /** 月の初日。 */
  month: DateOnly;
  perWeek: number;
  promisedOn: DateOnly;
  /** 決めた時点の、いつも通りの月末の見込み(中央)。 */
  usualYen: number;
  /** 決めた時点の、約束どおりの月末の見込み(中央)。月末の使った額がこれ以下なら守れた。 */
  limitYen: number;
};

export class PromiseStoreError extends Error {}

type Row = {
  genre_id: string;
  month: string;
  per_week: number;
  promised_on: string;
  usual_yen: number;
  limit_yen: number;
};

function toPromise(row: Row): SpendingPromise {
  return {
    genreId: row.genre_id,
    month: row.month,
    perWeek: row.per_week,
    promisedOn: row.promised_on,
    usualYen: row.usual_yen,
    limitYen: row.limit_yen,
  };
}

/** その月の約束(全ジャンル)。表が無ければ空。 */
export async function listPromises(months: readonly DateOnly[]): Promise<SpendingPromise[]> {
  if (months.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('spending_promises')
    .select('genre_id, month, per_week, promised_on, usual_yen, limit_yen')
    .in('month', [...months]);
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new PromiseStoreError(`約束を読み込めませんでした: ${error.message}`);
  }
  return (data ?? []).map(toPromise);
}

/** 約束を決める(同じ月・同じジャンルなら置き換える)。 */
export async function savePromise(promise: SpendingPromise): Promise<void> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new PromiseStoreError('ログイン状態を確認できませんでした');
  }
  const { error } = await supabase.from('spending_promises').upsert(
    {
      user_id: auth.user.id,
      genre_id: promise.genreId,
      month: promise.month,
      per_week: promise.perWeek,
      promised_on: promise.promisedOn,
      usual_yen: Math.max(0, Math.round(promise.usualYen)),
      limit_yen: Math.max(0, Math.round(promise.limitYen)),
    },
    { onConflict: 'user_id,genre_id,month' },
  );
  if (error) {
    if (isMissingTableError(error)) {
      throw new PromiseStoreError(
        '約束はまだ使えません(supabase/apply-pending.sql の適用が必要です)',
      );
    }
    throw new PromiseStoreError(`約束を保存できませんでした: ${error.message}`);
  }
}

/** 約束をやめる(いつも通りに戻す)。 */
export async function deletePromise(genreId: string, month: DateOnly): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('spending_promises')
    .delete()
    .eq('genre_id', genreId)
    .eq('month', month);
  if (error) {
    if (isMissingTableError(error)) {
      throw new PromiseStoreError(
        '約束はまだ使えません(supabase/apply-pending.sql の適用が必要です)',
      );
    }
    throw new PromiseStoreError(`約束をやめられませんでした: ${error.message}`);
  }
}

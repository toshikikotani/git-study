import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

class PlanMembershipError extends AppError {}

async function userId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new PlanMembershipError('ログイン状態を確認できませんでした');
  return { supabase, userId: data.user.id };
}

/** 目標に足せるジャンル一覧。支出が無くても出す。 */
export async function listGenreOptions(): Promise<{ genreId: string; genreName: string }[]> {
  const { supabase } = await userId();
  const { data, error } = await supabase.from('genres').select('id, name').order('sort_order');
  if (error) throw new PlanMembershipError(`ジャンルを取得できませんでした: ${error.message}`);
  return (data ?? []).map((genre) => ({ genreId: genre.id, genreName: genre.name }));
}

/** 期間中に発生したジャンルを、今の目標の行にする。既存行があれば金額だけ更新する。 */
export async function addPlanGenre(
  planId: string,
  genreId: string,
  targetYen: number,
): Promise<void> {
  if (!Number.isInteger(targetYen) || targetYen < 0) {
    throw new PlanMembershipError('目標額は0円以上の整数で入力してください');
  }
  const { supabase, userId: uid } = await userId();
  const { data: existing, error: readError } = await supabase
    .from('spending_plan_items')
    .select('id')
    .eq('plan_id', planId)
    .eq('genre_id', genreId)
    .maybeSingle();
  if (readError) {
    if (isMissingTableError(readError)) {
      throw new PlanMembershipError('目標を保存するテーブルがまだありません。');
    }
    throw new PlanMembershipError(`目標を確認できませんでした: ${readError.message}`);
  }
  if (existing) {
    const { error } = await supabase
      .from('spending_plan_items')
      .update({ target_yen: targetYen, reason: '期間中の支出から追加' })
      .eq('id', existing.id);
    if (error) throw new PlanMembershipError(`目標を更新できませんでした: ${error.message}`);
    return;
  }
  const { error } = await supabase.from('spending_plan_items').insert({
    plan_id: planId,
    user_id: uid,
    genre_id: genreId,
    target_yen: targetYen,
    ai_suggested_yen: null,
    reason: '期間中の支出から追加',
  });
  if (error) throw new PlanMembershipError(`目標に追加できませんでした: ${error.message}`);
}

/** この目標では数えない。支出は家計簿に残し、残り円と未収録の両方から外す。 */
export async function excludePlanGenre(planId: string, genreId: string): Promise<void> {
  const { supabase, userId: uid } = await userId();
  const { data: existing, error: readError } = await supabase
    .from('spending_plan_items')
    .select('id')
    .eq('plan_id', planId)
    .eq('genre_id', genreId)
    .maybeSingle();
  if (readError) throw new PlanMembershipError(`目標を確認できませんでした: ${readError.message}`);
  if (existing) {
    const { error } = await supabase
      .from('spending_plan_items')
      .update({ target_yen: 0, reason: 'この目標では数えない' })
      .eq('id', existing.id);
    if (error) throw new PlanMembershipError(`目標から外せませんでした: ${error.message}`);
    return;
  }
  const { error } = await supabase.from('spending_plan_items').insert({
    plan_id: planId,
    user_id: uid,
    genre_id: genreId,
    target_yen: 0,
    ai_suggested_yen: null,
    reason: 'この目標では数えない',
  });
  if (error) throw new PlanMembershipError(`目標から外せませんでした: ${error.message}`);
}

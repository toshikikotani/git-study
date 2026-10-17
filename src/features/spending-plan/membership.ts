import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import { ADDED_FROM_SPENDING } from './markers';

class PlanMembershipError extends AppError {}

export { ADDED_FROM_SPENDING };

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
  if (error) throw new PlanMembershipError(`カテゴリを取得できませんでした: ${error.message}`);
  return (data ?? []).map((genre) => ({ genreId: genre.id, genreName: genre.name }));
}

/**
 * 期間中に発生したジャンルを、今の目標の行にする。既存行があれば金額だけ更新する。
 * reason は行の印(既定は「期間中の支出から追加」=目標なしとして扱う。本人が額を決めたときは null)。
 */
export async function addPlanGenre(
  planId: string,
  genreId: string,
  targetYen: number,
  reason: string | null = ADDED_FROM_SPENDING,
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
      .update({ target_yen: targetYen, reason })
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
    reason,
  });
  if (error) throw new PlanMembershipError(`目標に追加できませんでした: ${error.message}`);
}

/** 本人が目標額を決めた行から「期間中の支出から追加」の印を外す(目標として扱う、ADR-108)。 */
export async function markTargetsChosen(
  planId: string,
  genreIds: readonly string[],
): Promise<void> {
  if (genreIds.length === 0) return;
  const { supabase } = await userId();
  const { error } = await supabase
    .from('spending_plan_items')
    .update({ reason: null })
    .eq('plan_id', planId)
    .eq('reason', ADDED_FROM_SPENDING)
    .in('genre_id', [...genreIds]);
  if (error) throw new PlanMembershipError(`目標を更新できませんでした: ${error.message}`);
}

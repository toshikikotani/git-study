import { findOverlap, overlapMessage } from '@/domain/plan-periods';
import { planPeriodDays } from '@/domain/spending-plan';
import { assertDateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import { ADDED_FROM_SPENDING } from './markers';
import { SpendingPlanStoreError } from './store';

export type PlanEditDraft = {
  periodStart: string;
  periodEnd: string;
  items: readonly { genreId: string; targetYen: number }[];
};

/**
 * 期間と配分は一つの保存単位。既存DBでも使えるよう、保存前に全入力を検証し、
 * 途中で失敗した場合は変更前の期間・金額・reasonへ戻す。復元の失敗も隠さない。
 */
export async function updatePlanDraft(planId: string, draft: PlanEditDraft): Promise<void> {
  const start = assertDateOnly(draft.periodStart);
  const end = assertDateOnly(draft.periodEnd);
  if (end < start) throw new SpendingPlanStoreError('終了日は開始日以降を選んでください');
  if (planPeriodDays(start, end) > 366) {
    throw new SpendingPlanStoreError('期間は1年以内にしてください');
  }
  if (
    draft.items.some((i) => !Number.isSafeInteger(i.targetYen) || i.targetYen < 0) ||
    new Set(draft.items.map((i) => i.genreId)).size !== draft.items.length
  ) {
    throw new SpendingPlanStoreError('カテゴリごとの目標額は0円以上の整数で入力してください');
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new SpendingPlanStoreError('ログイン状態を確認できませんでした');
  }
  const uid = auth.user.id;
  const [plans, items] = await Promise.all([
    supabase.from('spending_plans').select('id, period_start, period_end').eq('user_id', uid),
    supabase
      .from('spending_plan_items')
      .select('genre_id, target_yen, reason')
      .eq('plan_id', planId)
      .eq('user_id', uid),
  ]);
  if (plans.error || items.error) {
    throw new SpendingPlanStoreError('保存前の目標を確認できませんでした。もう一度お試しください');
  }
  const plan = plans.data.find((p) => p.id === planId);
  if (!plan) throw new SpendingPlanStoreError('目標が見つかりませんでした');
  const before = new Map(items.data.map((i) => [i.genre_id, i]));
  if (draft.items.some((i) => !before.has(i.genreId))) {
    throw new SpendingPlanStoreError(
      'カテゴリが変更されています。画面を更新してから保存してください',
    );
  }
  const overlap = findOverlap(
    plans.data
      .filter((p) => p.id !== planId)
      .map((p) => ({ id: p.id, periodStart: p.period_start, periodEnd: p.period_end })),
    { start, end },
  );
  if (overlap) throw new SpendingPlanStoreError(overlapMessage(overlap));

  const periodChanged = start !== plan.period_start || end !== plan.period_end;
  const changed = draft.items.filter((i) => i.targetYen !== before.get(i.genreId)!.target_yen);
  if (!periodChanged && changed.length === 0) return;

  // 各書き込みが完了してから復元する。並列の書き込みが復元後に到着するのを防ぐ。
  const written: string[] = [];
  let periodWritten = false;
  try {
    if (periodChanged) {
      // 通信失敗では更新済みの可能性もあるため、エラー時も復元対象にする。
      periodWritten = true;
      const { error } = await supabase
        .from('spending_plans')
        .update({ period_start: start, period_end: end })
        .eq('id', planId)
        .eq('user_id', uid);
      if (error) throw new Error(error.message);
    }
    for (const item of changed) {
      written.push(item.genreId);
      const previous = before.get(item.genreId)!;
      const { error } = await supabase
        .from('spending_plan_items')
        .update({
          target_yen: item.targetYen,
          reason: previous.reason === ADDED_FROM_SPENDING ? null : previous.reason,
        })
        .eq('plan_id', planId)
        .eq('genre_id', item.genreId)
        .eq('user_id', uid);
      if (error) throw new Error(error.message);
    }
  } catch {
    let restored = true;
    for (const id of written.reverse()) {
      try {
        const previous = before.get(id)!;
        const { error } = await supabase
          .from('spending_plan_items')
          .update({ target_yen: previous.target_yen, reason: previous.reason })
          .eq('plan_id', planId)
          .eq('genre_id', id)
          .eq('user_id', uid);
        if (error) restored = false;
      } catch {
        restored = false;
      }
    }
    if (periodWritten) {
      try {
        const { error } = await supabase
          .from('spending_plans')
          .update({ period_start: plan.period_start, period_end: plan.period_end })
          .eq('id', planId)
          .eq('user_id', uid);
        if (error) restored = false;
      } catch {
        restored = false;
      }
    }
    throw new SpendingPlanStoreError(
      restored
        ? '保存できなかったため、期間と配分を変更前に戻しました。入力内容は残っています。'
        : '保存と変更前への復元に失敗しました。一部の変更が保存されている可能性があります。画面を更新して確認してください。',
    );
  }
}

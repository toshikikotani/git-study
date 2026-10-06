/**
 * 目標(goals)のデータアクセス。命名は docs/glossary.md に従う。
 *
 * RLS が本人の行だけに絞る(ADR-011)ため SELECT は user_id を意識しない。
 * `goals` は本番未適用(B-10)。未適用時の扱いは lib/supabase/errors.ts。
 */

import {
  assertGoalCurrentAmountYen,
  assertGoalTargetAmountYen,
  assertGoalTitle,
} from '@/domain/goals';
import type { DateOnly } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export type GoalStatus = Database['public']['Enums']['goal_status'];

export type Goal = {
  id: string;
  title: string;
  targetAmountYen: number | null;
  targetDate: DateOnly | null;
  currentAmountYen: number;
  status: GoalStatus;
  note: string | null;
  createdAt: string;
  achievedAt: string | null;
};

/** 新規作成で本人(または AI相談での確認)が入力する項目。 */
export type GoalInput = {
  title: string;
  targetAmountYen: number | null;
  targetDate: DateOnly | null;
  note: string | null;
};

export class GoalStoreError extends AppError {}

type GoalRow = Database['public']['Tables']['goals']['Row'];

function fromRow(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    targetAmountYen: row.target_amount_yen,
    targetDate: row.target_date,
    currentAmountYen: row.current_amount_yen,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    achievedAt: row.achieved_at,
  };
}

/** 進行中の目標を、新しい順に返す。ホーム画面等では使わず(FR-61)、/advisor 専用。 */
export async function listActiveGoals(): Promise<Goal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new GoalStoreError(`目標を取得できませんでした: ${error.message}`);
  }
  return data.map(fromRow);
}

export async function createGoal(input: GoalInput): Promise<Goal> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new GoalStoreError('ログイン状態を確認できませんでした');
  }

  const title = assertGoalTitle(input.title);
  const targetAmountYen = assertGoalTargetAmountYen(input.targetAmountYen);

  const { data, error } = await supabase
    .from('goals')
    .insert({
      user_id: auth.user.id,
      title,
      target_amount_yen: targetAmountYen,
      target_date: input.targetDate,
      note: input.note,
    })
    .select('*')
    .single();

  if (error) {
    if (isMissingTableError(error)) throw new GoalStoreError('目標機能はまだ利用できません');
    throw new GoalStoreError(`目標を保存できませんでした: ${error.message}`);
  }
  return fromRow(data);
}

/**
 * 進捗額を更新する。目標金額に達した(またはそれを超えた)時点で自動的に
 * achieved へ倒す(FR-64 と同じ「肯定形」の考え方:本人が節目を見落とさない
 * ようにする)。目標金額を持たない目標(target_amount_yen が null)は
 * 自動達成の判定ができないため、本人が明示的に達成操作をするまで active のまま。
 */
export async function updateGoalProgress(id: string, currentAmountYen: number): Promise<Goal> {
  const supabase = await createClient();
  const amount = assertGoalCurrentAmountYen(currentAmountYen);

  const { data: existing, error: fetchError } = await supabase
    .from('goals')
    .select('target_amount_yen')
    .eq('id', id)
    .single();
  if (fetchError) {
    if (isMissingTableError(fetchError)) throw new GoalStoreError('目標機能はまだ利用できません');
    throw new GoalStoreError(`目標を取得できませんでした: ${fetchError.message}`);
  }

  const achieved = existing.target_amount_yen !== null && amount >= existing.target_amount_yen;

  const { data, error } = await supabase
    .from('goals')
    .update({
      current_amount_yen: amount,
      ...(achieved ? { status: 'achieved' as const, achieved_at: new Date().toISOString() } : {}),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    if (isMissingTableError(error)) throw new GoalStoreError('目標機能はまだ利用できません');
    throw new GoalStoreError(`進捗を更新できませんでした: ${error.message}`);
  }
  return fromRow(data);
}

/** 見送りにする(削除はしない。「前にこう考えたことがある」を残す)。 */
export async function abandonGoal(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('goals').update({ status: 'abandoned' }).eq('id', id);
  if (error) {
    if (isMissingTableError(error)) throw new GoalStoreError('目標機能はまだ利用できません');
    throw new GoalStoreError(`目標を更新できませんでした: ${error.message}`);
  }
}

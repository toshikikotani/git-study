/**
 * 目標(goals)のデータアクセス。命名は docs/glossary.md に従う。
 *
 * RLS が本人の行だけに絞る(ADR-011)ため SELECT は user_id を意識しない。
 * `goals` は本番未適用(B-10)。未適用時の扱いは lib/supabase/errors.ts。
 *
 * 目標は「貯金目標」として使う(ADR-081)。貯まった額は収入 − 支出から自動で数える
 * (features/savings/store.ts)。current_amount_yen は以前の手入力の名残で、もう使わない。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { assertGoalTargetAmountYen, assertGoalTitle } from '@/domain/goals';
import { todayJst, type DateOnly } from '@/lib/date';
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
  /** 貯金を数え始める日(作った日)。 */
  startOn: DateOnly;
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
    // start_on が未適用の本番(ADR-081 のマイグレーション前)では作った日から数える。
    startOn: (row as Partial<GoalRow>).start_on ?? todayJst(new Date(row.created_at)),
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    achievedAt: row.achieved_at,
  };
}

/** 進行中の目標を、新しい順に返す。 */
export async function listActiveGoals(): Promise<Goal[]> {
  const supabase = await createClient();
  return listActiveGoalsWith(supabase, null);
}

/** 進行中の目標(管理クライアント版。cron には本人のセッションが無いので user_id で絞る)。 */
export async function listActiveGoalsAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<Goal[]> {
  return listActiveGoalsWith(client, userId);
}

async function listActiveGoalsWith(
  client: SupabaseClient<Database>,
  userId: string | null,
): Promise<Goal[]> {
  let query = client.from('goals').select('*').eq('status', 'active');
  if (userId !== null) query = query.eq('user_id', userId);
  const { data, error } = await query.order('created_at', { ascending: false });
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

/** 達成にする(貯まった目標を、本人が「使った・済んだ」として閉じる)。 */
export async function achieveGoal(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('goals')
    .update({ status: 'achieved', achieved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    if (isMissingTableError(error)) throw new GoalStoreError('目標機能はまだ利用できません');
    throw new GoalStoreError(`目標を更新できませんでした: ${error.message}`);
  }
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

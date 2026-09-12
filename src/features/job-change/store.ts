/**
 * 転職準備チェックリスト(job_change_milestones)のデータアクセス(P3-2、FR-41)。
 *
 * `docs/mvp-plan.md` の対象外(フェーズ2以降)だが、スキーマは D-3 の時点で
 * 用意済み(job_change_milestones、milestone_phase/milestone_status)。
 * 並び替えは対象外(FR-41は「チェックリスト管理」までを求めており、
 * 手動並び替えは要件にない。sort_order は既定値のまま作成順に並ぶ)。
 */

import { todayJst, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export type MilestonePhase = Database['public']['Enums']['milestone_phase'];
export type MilestoneStatus = Database['public']['Enums']['milestone_status'];

export type Milestone = {
  id: string;
  phase: MilestonePhase;
  title: string;
  status: MilestoneStatus;
  dueOn: DateOnly | null;
  doneOn: DateOnly | null;
  note: string | null;
};

export class JobChangeStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobChangeStoreError';
  }
}

function fromRow(row: {
  id: string;
  phase: MilestonePhase;
  title: string;
  status: MilestoneStatus;
  due_on: string | null;
  done_on: string | null;
  note: string | null;
}): Milestone {
  return {
    id: row.id,
    phase: row.phase,
    title: row.title,
    status: row.status,
    dueOn: row.due_on,
    doneOn: row.done_on,
    note: row.note,
  };
}

/** フェーズ→表示順に並べる。フェーズ内は作成順(古い順)。 */
export async function listMilestones(): Promise<Milestone[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('job_change_milestones')
    .select('id, phase, title, status, due_on, done_on, note')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new JobChangeStoreError(`項目を取得できませんでした: ${error.message}`);
  return data.map(fromRow);
}

export type MilestoneInput = {
  phase: MilestonePhase;
  title: string;
  dueOn: DateOnly | null;
  note: string | null;
};

export async function createMilestone(input: MilestoneInput): Promise<Milestone> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new JobChangeStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('job_change_milestones')
    .insert({
      user_id: auth.user.id,
      phase: input.phase,
      title: input.title,
      due_on: input.dueOn,
      note: input.note,
    })
    .select('id, phase, title, status, due_on, done_on, note')
    .single();
  if (error) throw new JobChangeStoreError(`項目を作成できませんでした: ${error.message}`);
  return fromRow(data);
}

/**
 * ステータスを変更する。`ck_milestones_done`(status='done' と done_on の
 * 有無が一致すること)を満たすため、done へ移るときだけ done_on を立て、
 * それ以外へ戻すときは done_on を落とす。
 */
export async function setMilestoneStatus(
  id: string,
  status: MilestoneStatus,
  now: Date = new Date(),
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('job_change_milestones')
    .update({ status, done_on: status === 'done' ? todayJst(now) : null })
    .eq('id', id);
  if (error) throw new JobChangeStoreError(`状態を更新できませんでした: ${error.message}`);
}

export async function deleteMilestone(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('job_change_milestones').delete().eq('id', id);
  if (error) throw new JobChangeStoreError(`項目を削除できませんでした: ${error.message}`);
}

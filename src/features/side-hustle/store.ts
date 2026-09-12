/**
 * 副業トラッカー(side_projects / side_work_logs / side_incomes)のデータ
 * アクセス(P3-1、FR-40, FR-42)。
 *
 * `docs/mvp-plan.md` の対象外(フェーズ2以降)だが、スキーマは D-3 の時点で
 * 用意済み。証券口座連携などと同じく account_id/transaction_id/
 * transfer_run_id は当面 null のまま(手入力のみ)。
 */

import { computeIncomeAllocation } from '@/domain/side-hustle';
import { getAppSettings } from '@/features/settings/store';
import type { DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

export class SideHustleStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SideHustleStoreError';
  }
}

export type SideProject = {
  id: string;
  name: string;
  clientName: string | null;
  kind: string | null;
  isActive: boolean;
  note: string | null;
};

export async function listProjects(): Promise<SideProject[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('side_projects')
    .select('id, name, client_name, kind, is_active, note')
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new SideHustleStoreError(`プロジェクトを取得できませんでした: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    clientName: row.client_name,
    kind: row.kind,
    isActive: row.is_active,
    note: row.note,
  }));
}

export type ProjectInput = {
  name: string;
  clientName: string | null;
  kind: string | null;
  note: string | null;
};

export async function createProject(input: ProjectInput): Promise<SideProject> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new SideHustleStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('side_projects')
    .insert({
      user_id: auth.user.id,
      name: input.name,
      client_name: input.clientName,
      kind: input.kind,
      note: input.note,
    })
    .select('id, name, client_name, kind, is_active, note')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new SideHustleStoreError(`同じ名前のプロジェクトが既にあります: ${input.name}`);
    }
    throw new SideHustleStoreError(`プロジェクトを作成できませんでした: ${error.message}`);
  }

  return {
    id: data.id,
    name: data.name,
    clientName: data.client_name,
    kind: data.kind,
    isActive: data.is_active,
    note: data.note,
  };
}

export type SideWorkLog = {
  id: string;
  projectId: string;
  workedOn: DateOnly;
  minutes: number;
  summary: string | null;
};

/** 全プロジェクト分の作業ログを新しい順に返す。時給換算(FR-40)は呼び出し側で集計する。 */
export async function listWorkLogs(): Promise<SideWorkLog[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('side_work_logs')
    .select('id, project_id, worked_on, minutes, summary')
    .order('worked_on', { ascending: false });
  if (error) throw new SideHustleStoreError(`作業記録を取得できませんでした: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    workedOn: row.worked_on,
    minutes: row.minutes,
    summary: row.summary,
  }));
}

export type WorkLogInput = {
  projectId: string;
  workedOn: DateOnly;
  minutes: number;
  summary: string | null;
};

export async function createWorkLog(input: WorkLogInput): Promise<SideWorkLog> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new SideHustleStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('side_work_logs')
    .insert({
      user_id: auth.user.id,
      project_id: input.projectId,
      worked_on: input.workedOn,
      minutes: input.minutes,
      summary: input.summary,
    })
    .select('id, project_id, worked_on, minutes, summary')
    .single();
  if (error) throw new SideHustleStoreError(`作業記録を保存できませんでした: ${error.message}`);

  return {
    id: data.id,
    projectId: data.project_id,
    workedOn: data.worked_on,
    minutes: data.minutes,
    summary: data.summary,
  };
}

export type SideIncome = {
  id: string;
  projectId: string | null;
  receivedOn: DateOnly;
  amountYen: number;
  allocatedToRepaymentYen: number | null;
  allocatedToInvestmentYen: number | null;
  note: string | null;
};

export async function listIncomes(): Promise<SideIncome[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('side_incomes')
    .select(
      'id, project_id, received_on, amount_yen, allocated_to_repayment_yen, allocated_to_investment_yen, note',
    )
    .order('received_on', { ascending: false });
  if (error) throw new SideHustleStoreError(`入金記録を取得できませんでした: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    receivedOn: row.received_on,
    amountYen: row.amount_yen,
    allocatedToRepaymentYen: row.allocated_to_repayment_yen,
    allocatedToInvestmentYen: row.allocated_to_investment_yen,
    note: row.note,
  }));
}

export type IncomeInput = {
  projectId: string | null;
  receivedOn: DateOnly;
  amountYen: number;
  note: string | null;
};

/**
 * 入金を記録する。振り分け(FR-42)は `app_settings.side_income_repayment_ratio`
 * (既定 7:3)を使ってここで自動計算し、`allocated_to_*` へ保存する。
 * 実際の振替(送金)は本アプリの対象外(他の資金移動と同じく手動で行い、
 * ここに出す金額は「いくら動かせばよいか」の指示)。
 */
export async function createIncome(input: IncomeInput): Promise<SideIncome> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new SideHustleStoreError('ログイン状態を確認できませんでした');
  }

  const settings = await getAppSettings();
  const allocation = computeIncomeAllocation(input.amountYen, settings.sideIncomeRepaymentRatio);

  const { data, error } = await supabase
    .from('side_incomes')
    .insert({
      user_id: auth.user.id,
      project_id: input.projectId,
      received_on: input.receivedOn,
      amount_yen: input.amountYen,
      allocated_to_repayment_yen: allocation.repaymentYen,
      allocated_to_investment_yen: allocation.investmentYen,
      note: input.note,
    })
    .select(
      'id, project_id, received_on, amount_yen, allocated_to_repayment_yen, allocated_to_investment_yen, note',
    )
    .single();
  if (error) throw new SideHustleStoreError(`入金記録を保存できませんでした: ${error.message}`);

  return {
    id: data.id,
    projectId: data.project_id,
    receivedOn: data.received_on,
    amountYen: data.amount_yen,
    allocatedToRepaymentYen: data.allocated_to_repayment_yen,
    allocatedToInvestmentYen: data.allocated_to_investment_yen,
    note: data.note,
  };
}

/**
 * 投資の拠出・残高のデータアクセス(M7-2)。
 */

import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import type { DateOnly } from '@/lib/date';
import type { Database } from '@/lib/supabase/types';

export class InvestmentStoreError extends AppError {}

/**
 * 拠出(フロー)と残高(ストック)の記録(M7-2、FR-51)。
 *
 * 証券口座連携は当面対象外のため account_id は扱わない(常に null)。
 * 残高は「同じ日・同じ商品なら上書き」が要件(DoD)。実テーブルの一意制約
 * (`ux_snapshots_user_account_product_date`)は coalesce を挟んだ式インデックス
 * のため PostgREST の `upsert(onConflict:)` がそのまま使えず、既存行の有無を
 * 先に確認してから insert/update を分ける(先勝ち・単一ユーザーのため
 * 競合の実害は無い)。
 */

export type InvestmentContribution = {
  id: string;
  contributedOn: DateOnly;
  amountYen: number;
  productName: string | null;
  isHighRisk: boolean;
  note: string | null;
};

export type InvestmentContributionInput = {
  contributedOn: DateOnly;
  amountYen: number;
  productName: string | null;
  isHighRisk: boolean;
  note: string | null;
};

type ContributionRow = Database['public']['Tables']['investment_contributions']['Row'];

function fromContributionRow(row: ContributionRow): InvestmentContribution {
  return {
    id: row.id,
    contributedOn: row.contributed_on,
    amountYen: row.amount_yen,
    productName: row.product_name,
    isHighRisk: row.is_high_risk,
    note: row.note,
  };
}

export async function listInvestmentContributions(): Promise<InvestmentContribution[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('investment_contributions')
    .select('*')
    .order('contributed_on', { ascending: false });
  if (error) {
    throw new InvestmentStoreError(`拠出の一覧を取得できませんでした: ${error.message}`);
  }
  return data.map(fromContributionRow);
}

export async function createInvestmentContribution(
  input: InvestmentContributionInput,
): Promise<InvestmentContribution> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new InvestmentStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('investment_contributions')
    .insert({
      user_id: auth.user.id,
      contributed_on: input.contributedOn,
      amount_yen: input.amountYen,
      product_name: input.productName,
      is_high_risk: input.isHighRisk,
      note: input.note,
    })
    .select('*')
    .single();
  if (error) throw new InvestmentStoreError(`拠出を記録できませんでした: ${error.message}`);
  return fromContributionRow(data);
}

export type InvestmentSnapshot = {
  id: string;
  asOf: DateOnly;
  marketValueYen: number;
  costBasisYen: number | null;
  productName: string | null;
};

export type InvestmentSnapshotInput = {
  asOf: DateOnly;
  marketValueYen: number;
  costBasisYen: number | null;
  productName: string;
};

type SnapshotRow = Database['public']['Tables']['investment_snapshots']['Row'];

function fromSnapshotRow(row: SnapshotRow): InvestmentSnapshot {
  return {
    id: row.id,
    asOf: row.as_of,
    marketValueYen: row.market_value_yen,
    costBasisYen: row.cost_basis_yen,
    productName: row.product_name,
  };
}

export async function listInvestmentSnapshots(): Promise<InvestmentSnapshot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('investment_snapshots')
    .select('*')
    .order('as_of', { ascending: false });
  if (error) {
    throw new InvestmentStoreError(`残高の一覧を取得できませんでした: ${error.message}`);
  }
  return data.map(fromSnapshotRow);
}

/** 同じ日・同じ商品の記録が既にあれば上書き、無ければ新規作成する(DoD)。 */
export async function upsertInvestmentSnapshot(
  input: InvestmentSnapshotInput,
): Promise<InvestmentSnapshot> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new InvestmentStoreError('ログイン状態を確認できませんでした');
  }

  const { data: existing, error: existingError } = await supabase
    .from('investment_snapshots')
    .select('id')
    .is('account_id', null)
    .eq('product_name', input.productName)
    .eq('as_of', input.asOf)
    .maybeSingle();
  if (existingError) {
    throw new InvestmentStoreError(`既存の残高を確認できませんでした: ${existingError.message}`);
  }

  if (existing) {
    const { data, error } = await supabase
      .from('investment_snapshots')
      .update({
        market_value_yen: input.marketValueYen,
        cost_basis_yen: input.costBasisYen,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new InvestmentStoreError(`残高を更新できませんでした: ${error.message}`);
    return fromSnapshotRow(data);
  }

  const { data, error } = await supabase
    .from('investment_snapshots')
    .insert({
      user_id: auth.user.id,
      as_of: input.asOf,
      market_value_yen: input.marketValueYen,
      cost_basis_yen: input.costBasisYen,
      product_name: input.productName,
    })
    .select('*')
    .single();
  if (error) throw new InvestmentStoreError(`残高を保存できませんでした: ${error.message}`);
  return fromSnapshotRow(data);
}

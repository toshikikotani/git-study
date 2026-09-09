/**
 * 借り換えシミュレーションの保存(repayment_scenarios、M1-4、FR-04)。
 *
 * シミュレーション自体は domain/payoff.ts の純粋関数(画面側で即時計算)。
 * ここで保存するのは、その時点の入力と計算結果のスナップショットだけ。
 * 命名は docs/glossary.md の「レイヤーの命名」に従う(list/create/delete)。
 */

import { createClient } from '@/lib/supabase/server';
import type { DateOnly } from '@/lib/date';
import type { Database } from '@/lib/supabase/types';

export type RepaymentStrategy = Database['public']['Enums']['repayment_strategy'];

export type Scenario = {
  id: string;
  name: string;
  strategy: RepaymentStrategy;
  monthlyBudgetYen: number | null;
  /** 借り換え後の年利。通常の返済シナリオでは null。 */
  overrideAnnualRate: number | null;
  monthsToPayoff: number | null;
  payoffOn: DateOnly | null;
  totalInterestYen: number | null;
  totalPaidYen: number | null;
};

/** 保存時に本人が確認した計算結果。ここで再計算はしない(表示時点の値をそのまま残す)。 */
export type ScenarioInput = {
  name: string;
  strategy: RepaymentStrategy;
  monthlyBudgetYen: number;
  overrideAnnualRate: number;
  monthsToPayoff: number;
  payoffOn: DateOnly;
  totalInterestYen: number;
  totalPaidYen: number;
};

export class ScenarioStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioStoreError';
  }
}

type ScenarioRow = Database['public']['Tables']['repayment_scenarios']['Row'];

function fromRow(row: ScenarioRow): Scenario {
  return {
    id: row.id,
    name: row.name,
    strategy: row.strategy,
    monthlyBudgetYen: row.monthly_budget_yen,
    overrideAnnualRate: row.override_annual_rate,
    monthsToPayoff: row.months_to_payoff,
    payoffOn: row.payoff_on,
    totalInterestYen: row.total_interest_yen,
    totalPaidYen: row.total_paid_yen,
  };
}

/** 借り換えシナリオ(override_annual_rate が入っている行)を新しい順に返す。 */
export async function listRefinanceScenarios(): Promise<Scenario[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('repayment_scenarios')
    .select('*')
    .not('override_annual_rate', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw new ScenarioStoreError(`シナリオを取得できませんでした: ${error.message}`);
  return data.map(fromRow);
}

export async function createScenario(input: ScenarioInput): Promise<Scenario> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new ScenarioStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('repayment_scenarios')
    .upsert(
      {
        user_id: auth.user.id,
        name: input.name,
        strategy: input.strategy,
        monthly_budget_yen: input.monthlyBudgetYen,
        override_annual_rate: input.overrideAnnualRate,
        months_to_payoff: input.monthsToPayoff,
        payoff_on: input.payoffOn,
        total_interest_yen: input.totalInterestYen,
        total_paid_yen: input.totalPaidYen,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,name' },
    )
    .select('*')
    .single();

  if (error) throw new ScenarioStoreError(`シナリオを保存できませんでした: ${error.message}`);
  return fromRow(data);
}

export async function deleteScenario(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('repayment_scenarios').delete().eq('id', id);
  if (error) throw new ScenarioStoreError(`シナリオを削除できませんでした: ${error.message}`);
}

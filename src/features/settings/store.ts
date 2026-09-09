/**
 * 本人設定(app_settings)のデータアクセス。
 *
 * ユーザーあたり1行(user_id が主キー)。RLS が本人の行に絞る(ADR-011)ので、
 * ここでも user_id を意識しない。まだ画面から編集する手段は無く、既定値を
 * 読むためだけに使う(ホームの完済見込み・負債タブのシミュレーション)。
 */

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export type RepaymentStrategy = Database['public']['Enums']['repayment_strategy'];

export type AppSettings = {
  monthlyRepaymentTargetYen: number;
  repaymentStrategy: RepaymentStrategy;
  /** 返済目標額に対する投資額の比率(0〜1)。既定 0.2(FR-50)。 */
  investmentRatioOfRepayment: number;
  /** 完済を機に高リスク投資枠が解禁されているか(FR-52)。 */
  isHighRiskUnlocked: boolean;
  /** 高リスク枠解禁後、投資総額のうち高リスク枠に回す比率(0〜1)。既定 0.3。 */
  highRiskAllocationRatio: number;
  /** 給料日(1〜31)。月末に無い日は月末に丸める(M4-4)。既定25。 */
  payday: number;
};

export class SettingsStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsStoreError';
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'monthly_repayment_target_yen, repayment_strategy, investment_ratio_of_repayment, is_high_risk_unlocked, high_risk_allocation_ratio, payday',
    )
    .single();
  if (error) throw new SettingsStoreError(`設定を取得できませんでした: ${error.message}`);

  return {
    monthlyRepaymentTargetYen: data.monthly_repayment_target_yen,
    repaymentStrategy: data.repayment_strategy,
    investmentRatioOfRepayment: data.investment_ratio_of_repayment,
    isHighRiskUnlocked: data.is_high_risk_unlocked,
    highRiskAllocationRatio: data.high_risk_allocation_ratio,
    payday: data.payday,
  };
}

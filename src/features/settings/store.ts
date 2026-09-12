/**
 * 本人設定(app_settings)のデータアクセス。
 *
 * ユーザーあたり1行(user_id が主キー)。RLS が本人の行に絞る(ADR-011)ので、
 * ここでも user_id を意識しない。まだ画面から編集する手段は無く、既定値を
 * 読むためだけに使う(ホームの完済見込み・負債タブのシミュレーション)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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
  /** AI 分類の確信度がこれ未満なら「確認待ち」に回す(0〜1)。既定 0.8(ADR-010)。 */
  classificationConfidenceThreshold: number;
  /** 給料日(1〜31)。月末に無い日は月末に丸める(M4-4)。既定25。 */
  payday: number;
};

export class SettingsStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsStoreError';
  }
}

/**
 * 本人設定を1件取得する(管理クライアント版)。
 *
 * cron ジョブには本人のセッションが無く RLS に頼れないため、user_id を
 * 明示して絞り込む(M5-2 の朝配信ジョブから利用)。
 */
export async function getAppSettingsAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<AppSettings> {
  const { data, error } = await client
    .from('app_settings')
    .select(
      'monthly_repayment_target_yen, repayment_strategy, investment_ratio_of_repayment, is_high_risk_unlocked, high_risk_allocation_ratio, classification_confidence_threshold, payday',
    )
    .eq('user_id', userId)
    .single();
  if (error) throw new SettingsStoreError(`設定を取得できませんでした: ${error.message}`);

  return {
    monthlyRepaymentTargetYen: data.monthly_repayment_target_yen,
    repaymentStrategy: data.repayment_strategy,
    investmentRatioOfRepayment: data.investment_ratio_of_repayment,
    isHighRiskUnlocked: data.is_high_risk_unlocked,
    highRiskAllocationRatio: data.high_risk_allocation_ratio,
    classificationConfidenceThreshold: data.classification_confidence_threshold,
    payday: data.payday,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new SettingsStoreError('ログイン状態を確認できませんでした');
  }
  return getAppSettingsAsAdmin(supabase, auth.user.id);
}

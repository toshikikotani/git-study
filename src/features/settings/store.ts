/**
 * 本人設定(app_settings)のデータアクセス。
 *
 * ユーザーあたり1行(user_id が主キー)。RLS が本人の行に絞る(ADR-011)ので、
 * ここでも user_id を意識しない。長らく画面から編集する手段が無く既定値を
 * 読むためだけに使っていたが、「AIに変更を頼む」統合チャット(本人発案、
 * ADR-054)向けに updateAppSettings() を追加した。ここで公開する列は
 * すべて「業務パラメータ」(ADR-014)であり、シークレット(env変数名の
 * 参照値)を保持する列は元々このテーブルに存在しない——将来そのような列を
 * 足す場合も、この汎用更新関数と会話ツールには決して含めないこと。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '@/lib/errors';
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
  /** 副業収入のうち返済に回す比率(0〜1)。既定 0.7(FR-42、P3-1)。 */
  sideIncomeRepaymentRatio: number;
};

export class SettingsStoreError extends AppError {}

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
      'monthly_repayment_target_yen, repayment_strategy, investment_ratio_of_repayment, is_high_risk_unlocked, high_risk_allocation_ratio, payday, side_income_repayment_ratio',
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
    payday: data.payday,
    sideIncomeRepaymentRatio: data.side_income_repayment_ratio,
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

/** 変更したい項目だけを渡す(渡さなかった項目は変更しない)。 */
export type AppSettingsPatch = Partial<AppSettings>;

/**
 * 本人設定を部分的に更新する(本人発案「AIに変更を頼む」、ADR-054)。
 * `AppSettings` に無い列(シークレット等)は型上そもそも渡せない。
 */
export async function updateAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new SettingsStoreError('ログイン状態を確認できませんでした');
  }

  const row: Database['public']['Tables']['app_settings']['Update'] = {};
  if (patch.monthlyRepaymentTargetYen !== undefined) {
    row.monthly_repayment_target_yen = patch.monthlyRepaymentTargetYen;
  }
  if (patch.repaymentStrategy !== undefined) row.repayment_strategy = patch.repaymentStrategy;
  if (patch.investmentRatioOfRepayment !== undefined) {
    row.investment_ratio_of_repayment = patch.investmentRatioOfRepayment;
  }
  if (patch.isHighRiskUnlocked !== undefined) row.is_high_risk_unlocked = patch.isHighRiskUnlocked;
  if (patch.highRiskAllocationRatio !== undefined) {
    row.high_risk_allocation_ratio = patch.highRiskAllocationRatio;
  }
  if (patch.payday !== undefined) row.payday = patch.payday;
  if (patch.sideIncomeRepaymentRatio !== undefined) {
    row.side_income_repayment_ratio = patch.sideIncomeRepaymentRatio;
  }

  const { error } = await supabase.from('app_settings').update(row).eq('user_id', auth.user.id);
  if (error) throw new SettingsStoreError(`設定を更新できませんでした: ${error.message}`);
  return getAppSettingsAsAdmin(supabase, auth.user.id);
}

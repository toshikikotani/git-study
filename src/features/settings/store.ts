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
import { isMissingColumnError } from '@/lib/supabase/errors';
import type { Database } from '@/lib/supabase/types';

export type AppSettings = {
  /** 毎月の貯金目標(円)。給料日の振替・投資額の基準(ADR-080)。 */
  monthlySavingsTargetYen: number;
  /** 貯金目標額に対する投資額の比率(0〜1)。既定 0.2(FR-50)。 */
  investmentRatioOfSavings: number;
  /** 高リスク投資の枠を使うか(本人が設定で切り替える。ADR-080)。 */
  isHighRiskUnlocked: boolean;
  /** 高リスク枠を使うとき、投資総額のうち高リスク枠に回す比率(0〜1)。既定 0.3。 */
  highRiskAllocationRatio: number;
  /** 給料日(1〜31)。月末に無い日は月末に丸める(M4-4)。既定25。 */
  payday: number;
  /** 副業収入のうち貯金に回す比率(0〜1)。既定 0.7(FR-42、P3-1)。 */
  sideIncomeSavingsRatio: number;
  /** 全AI機能の一括オフ(N1)。false でもアプリの基本機能はすべて使える。既定 true。 */
  aiEnabled: boolean;
};

export class SettingsStoreError extends AppError {}

/** 列名を「貯金」に変えるマイグレーション(ADR-080)が未適用の本番では、旧い列名で持っている。 */
const LEGACY_COLUMNS = {
  monthly_savings_target_yen: 'monthly_repayment_target_yen',
  investment_ratio_of_savings: 'investment_ratio_of_repayment',
  side_income_savings_ratio: 'side_income_repayment_ratio',
} as const;

function pickNumber(row: Record<string, unknown>, column: keyof typeof LEGACY_COLUMNS): number {
  const value = row[column] ?? row[LEGACY_COLUMNS[column]];
  return typeof value === 'number' ? value : 0;
}

/**
 * 本人設定を1件取得する(管理クライアント版)。
 *
 * cron ジョブには本人のセッションが無く RLS に頼れないため、user_id を
 * 明示して絞り込む(M5-2 の朝配信ジョブから利用)。
 * 列は `*` で読む:未適用の列(ai_enabled、貯金への改名)があっても落ちない(ADR-033)。
 */
export async function getAppSettingsAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<AppSettings> {
  const { data, error } = await client
    .from('app_settings')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error) throw new SettingsStoreError(`設定を取得できませんでした: ${error.message}`);
  if (data === null) throw new SettingsStoreError('設定を取得できませんでした');

  const row = data as unknown as Record<string, unknown>;
  return {
    monthlySavingsTargetYen: pickNumber(row, 'monthly_savings_target_yen'),
    investmentRatioOfSavings: pickNumber(row, 'investment_ratio_of_savings'),
    isHighRiskUnlocked: row.is_high_risk_unlocked === true,
    highRiskAllocationRatio: Number(row.high_risk_allocation_ratio ?? 0),
    payday: Number(row.payday ?? 25),
    sideIncomeSavingsRatio: pickNumber(row, 'side_income_savings_ratio'),
    aiEnabled: typeof row.ai_enabled === 'boolean' ? row.ai_enabled : true,
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
  if (patch.monthlySavingsTargetYen !== undefined) {
    row.monthly_savings_target_yen = patch.monthlySavingsTargetYen;
  }
  if (patch.investmentRatioOfSavings !== undefined) {
    row.investment_ratio_of_savings = patch.investmentRatioOfSavings;
  }
  if (patch.isHighRiskUnlocked !== undefined) row.is_high_risk_unlocked = patch.isHighRiskUnlocked;
  if (patch.highRiskAllocationRatio !== undefined) {
    row.high_risk_allocation_ratio = patch.highRiskAllocationRatio;
  }
  if (patch.payday !== undefined) row.payday = patch.payday;
  if (patch.sideIncomeSavingsRatio !== undefined) {
    row.side_income_savings_ratio = patch.sideIncomeSavingsRatio;
  }
  if (patch.aiEnabled !== undefined) row.ai_enabled = patch.aiEnabled;

  let { error } = await supabase.from('app_settings').update(row).eq('user_id', auth.user.id);
  if (error && isMissingColumnError(error)) {
    // 貯金への改名が未適用なら、旧い列名で書く。
    const legacy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      legacy[LEGACY_COLUMNS[key as keyof typeof LEGACY_COLUMNS] ?? key] = value;
    }
    ({ error } = await supabase
      .from('app_settings')
      .update(legacy as typeof row)
      .eq('user_id', auth.user.id));
  }
  if (error) throw new SettingsStoreError(`設定を更新できませんでした: ${error.message}`);
  return getAppSettingsAsAdmin(supabase, auth.user.id);
}

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
    .select('monthly_repayment_target_yen, repayment_strategy')
    .single();
  if (error) throw new SettingsStoreError(`設定を取得できませんでした: ${error.message}`);

  return {
    monthlyRepaymentTargetYen: data.monthly_repayment_target_yen,
    repaymentStrategy: data.repayment_strategy,
  };
}

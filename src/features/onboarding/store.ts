/**
 * はじめての設定のデータアクセス(ADR-084)。判断は domain/onboarding.ts。
 */

import { cookies } from 'next/headers';

import { needsOnboarding } from '@/domain/onboarding';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

/** 「あとで」を選んだ人の cookie。同じ端末で別の人がログインしても混ざらないよう、値は user_id。 */
export const WELCOME_SKIPPED_COOKIE = 'welcome_skipped';

export class OnboardingStoreError extends AppError {}

/** いまの人に、はじめての設定を出すか。調べられないときは出さない(画面を止めない。原因はログに残す)。 */
export async function shouldShowOnboarding(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return false;
    const jar = await cookies();
    const skipped = jar.get(WELCOME_SKIPPED_COOKIE)?.value === auth.user.id;
    if (skipped) return false;

    const plans = await supabase.from('spending_plans').select('id').limit(1);
    if (plans.error && !isMissingTableError(plans.error)) {
      console.error('[onboarding] 目標を確かめられませんでした', plans.error);
      return false;
    }
    return needsOnboarding({ hasPlan: (plans.data ?? []).length > 0, skipped });
  } catch (error) {
    console.error('[onboarding] はじめての設定を出すか確かめられませんでした', error);
    return false;
  }
}

export type IncomeSettings = { takeHomeYen: number; payday: number };

/** 手取り(月)と給料日。行が無ければ既定値。 */
export async function getIncomeSettings(): Promise<IncomeSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('app_settings')
    .select('monthly_take_home_yen, payday')
    .maybeSingle();
  return {
    takeHomeYen: data?.monthly_take_home_yen ?? 250_000,
    payday: data?.payday ?? 25,
  };
}

/** 手取り(月)と給料日を保存する(行が無ければ作る)。 */
export async function saveIncomeSettings(input: IncomeSettings): Promise<void> {
  if (!Number.isInteger(input.takeHomeYen) || input.takeHomeYen <= 0) {
    throw new OnboardingStoreError('手取りは1円以上の整数で入力してください');
  }
  if (!Number.isInteger(input.payday) || input.payday < 1 || input.payday > 31) {
    throw new OnboardingStoreError('給料日は1〜31日で選んでください');
  }
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new OnboardingStoreError('ログイン状態を確認できませんでした');
  }
  const { error } = await supabase.from('app_settings').upsert(
    {
      user_id: auth.user.id,
      monthly_take_home_yen: input.takeHomeYen,
      payday: input.payday,
    },
    { onConflict: 'user_id' },
  );
  if (error)
    throw new OnboardingStoreError(`手取りと給料日を保存できませんでした: ${error.message}`);
}

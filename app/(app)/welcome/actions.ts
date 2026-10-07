'use server';

/**
 * はじめての設定(/welcome)の Server Action(ADR-084)。
 *
 * 手取りと給料日 → 今日からの目標(ジャンルごとの額)→ 貯金目標(任意)を、1回でまとめて保存する。
 * 目標と貯金目標の保存は、既存の店(spending-plan・goals)をそのまま使う。
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createGoal } from '@/features/goals/store';
import { saveIncomeSettings, WELCOME_SKIPPED_COOKIE } from '@/features/onboarding/store';
import { savePlan } from '@/features/spending-plan/store';
import { describeUserError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

export type WelcomeInput = {
  takeHomeYen: number;
  payday: number;
  periodStart: string;
  periodEnd: string;
  items: { genreId: string; targetYen: number }[];
  savingsGoal: { title: string; targetAmountYen: number | null; targetDate: string | null } | null;
};

export async function completeWelcomeAction(
  input: WelcomeInput,
): Promise<{ error: string | null }> {
  try {
    await saveIncomeSettings({ takeHomeYen: input.takeHomeYen, payday: input.payday });
    await savePlan({
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      stepPercent: 10,
      items: input.items.map((item) => ({
        genreId: item.genreId,
        targetYen: item.targetYen,
        aiSuggestedYen: null,
        reason: 'はじめての設定で決めた額',
      })),
    });
    if (input.savingsGoal !== null && input.savingsGoal.title.trim() !== '') {
      await createGoal({ ...input.savingsGoal, note: null });
    }
  } catch (error) {
    return { error: describeUserError(error, '保存できませんでした。もう一度お試しください。') };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

/** 「あとで」:この人には、はじめての設定を出さない(目標の画面からいつでも立てられる)。 */
export async function skipWelcomeAction(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    const jar = await cookies();
    jar.set(WELCOME_SKIPPED_COOKIE, data.user.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  }
  redirect('/');
}

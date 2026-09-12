/**
 * 連続確認日数(app_checkins / v_checkin_streak)のデータアクセス(FR-62)。
 *
 * ストリークの計算そのものは SQL 側(docs/schema.sql の v_checkin_streak)が
 * 正。ここでは「今日確認した」ことを記録する upsert と、そのビューを
 * 読むだけを担う。途切れても責めない(設計原則3)ための文言判断は
 * 呼び出し側(画面)が行う。
 */

import { todayJst, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

export class CheckinStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckinStoreError';
  }
}

export type CheckinStreak = {
  currentStreakDays: number;
  longestStreakDays: number;
  lastCheckinOn: DateOnly | null;
};

/**
 * 今日確認したことを記録する。同じ日に何度呼んでも1行のまま
 * (app_checkins の主キーが user_id, checked_on)。
 */
export async function recordCheckin(now: Date = new Date()): Promise<void> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return;

  const { error } = await supabase
    .from('app_checkins')
    .upsert(
      { user_id: auth.user.id, checked_on: todayJst(now), source: 'web' },
      { onConflict: 'user_id,checked_on', ignoreDuplicates: true },
    );
  if (error) throw new CheckinStoreError(`確認記録を保存できませんでした: ${error.message}`);
}

export async function getCheckinStreak(): Promise<CheckinStreak> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('v_checkin_streak').select('*').maybeSingle();
  if (error) throw new CheckinStoreError(`ストリークを取得できませんでした: ${error.message}`);

  return {
    currentStreakDays: data?.current_streak_days ?? 0,
    longestStreakDays: data?.longest_streak_days ?? 0,
    lastCheckinOn: data?.last_checkin_on ?? null,
  };
}

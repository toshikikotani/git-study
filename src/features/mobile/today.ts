/**
 * iPhone アプリの「今日」(GET /api/mobile/today、ADR-132)。Web の今日の画面(app/(app)/page.tsx)と
 * 同じ関数で数える:今日の目安・明日からの目安・今期の見通しは loadTodayForecasts、今日やることは
 * 答え合わせ(確認待ちを含む)・入力待ちのレシート・給料日(ADR-131)。
 *
 * 本人のセッション(cookie か、アプリのトークン)の間に呼ぶ。
 */

import { todayAllowance } from '@/domain/forecast/today';
import { needsInputSummary } from '@/features/home/pending';
import { loadTodayForecasts, todayCapYen } from '@/features/home/today-forecasts';
import { listTodayCheck } from '@/features/today-check/store';
import { resolvePaydayChecklistState } from '@/features/transfer-runs/store';
import { daysBetween } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { MobileRecord, MobileToday } from './contract';

/** 2026-10-01 → 10/1 */
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export async function loadMobileToday(userId: string, now = new Date()): Promise<MobileToday> {
  const supabase = await createClient();
  const forecasts = await loadTodayForecasts(now);
  const { today, goal, goalView } = forecasts;
  const forecast = goalView?.forecast ?? null;

  const [checkItems, captures, payday, records] = await Promise.all([
    listTodayCheck(supabase, userId, today).catch(() => []),
    needsInputSummary(),
    resolvePaydayChecklistState(today).catch(() => null),
    loadTodayRecords(userId, today),
  ]);

  const allowance =
    forecast && goal && goalView
      ? todayAllowance({ capYen: todayCapYen(goalView), spentTodayYen: goalView.todaySpentYen })
      : null;
  const periodTo = goal?.period.to ?? today;

  return {
    today,
    allowance:
      allowance === null
        ? null
        : allowance.kind === 'left'
          ? { kind: 'left', yen: allowance.leftYen }
          : { kind: 'over', yen: allowance.overYen },
    provisional: forecast?.provisional ?? false,
    tomorrowYen: goalView?.tomorrowLimit?.todayLimitYen ?? null,
    outlook:
      goal && forecast
        ? {
            periodLabel: `${shortDate(goal.period.from)}〜${shortDate(goal.period.to)} · 残り${Math.max(0, daysBetween(today, periodTo) + 1)}日`,
            spentYen: forecast.breakdown.actualYen,
            p50Yen: forecast.total.p50,
            budgetYen: goal.budgetYen,
            probWithin: forecast.probWithinBudget,
          }
        : null,
    todo: {
      checkCount: checkItems.length,
      capturesCount: captures.count,
      payday: payday !== null && (payday.kind === 'needs_amount' || payday.kind === 'checklist'),
    },
    records,
  };
}

/** 今日の記録(新しい順、最大30件)。 */
export async function loadTodayRecords(userId: string, today: string): Promise<MobileRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transactions')
    .select('id, occurred_on, description, merchant_name, amount_yen, genre_id')
    .eq('user_id', userId)
    .eq('occurred_on', today)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error || !data) return [];
  return withGenreNames(
    userId,
    data.map((r) => ({
      id: r.id,
      occurredOn: r.occurred_on,
      label: (r.merchant_name ?? '').trim() || r.description,
      amountYen: r.amount_yen,
      genreId: r.genre_id,
      genreName: null,
    })),
  );
}

/** カテゴリの名前を付ける。 */
export async function withGenreNames(
  userId: string,
  records: MobileRecord[],
): Promise<MobileRecord[]> {
  const ids = [...new Set(records.flatMap((r) => (r.genreId ? [r.genreId] : [])))];
  if (ids.length === 0) return records;
  const supabase = await createClient();
  const { data } = await supabase
    .from('genres')
    .select('id, name')
    .eq('user_id', userId)
    .in('id', ids);
  const names = new Map((data ?? []).map((g) => [g.id, g.name]));
  return records.map((r) => ({
    ...r,
    genreName: r.genreId ? (names.get(r.genreId) ?? null) : null,
  }));
}

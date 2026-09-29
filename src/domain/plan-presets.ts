/**
 * 目標の期間プリセット。初期選択は「1週間」(短い期間から始めて、結果を見て次の目標へ、
 * という振り返りのループを回しやすくするため)。
 */

import { paydayCycleFor, addDays, addMonths, nthDayOfMonth, type DateOnly } from '@/lib/date';

export type PlanPresetId = 'one_week' | 'until_payday' | 'month_end' | 'next_month_end';

export const DEFAULT_PLAN_PRESET: PlanPresetId = 'one_week';

export const PLAN_PRESET_LABELS: Record<PlanPresetId, string> = {
  one_week: '1週間',
  until_payday: '給料日まで',
  month_end: '今月末まで',
  next_month_end: '来月末まで',
};

export const PLAN_PRESET_ORDER: readonly PlanPresetId[] = [
  'one_week',
  'until_payday',
  'month_end',
  'next_month_end',
];

function lastDayOfMonth(date: DateOnly, offsetMonths: number): DateOnly {
  return addDays(addMonths(nthDayOfMonth(date, 1), offsetMonths + 1), -1);
}

/** プリセットの期間(開始は今日)。payday は給料日(1〜31)。 */
export function planPreset(
  id: PlanPresetId,
  today: DateOnly,
  payday: number,
): { start: DateOnly; end: DateOnly } {
  switch (id) {
    case 'one_week':
      return { start: today, end: addDays(today, 6) };
    case 'until_payday':
      // 次の給料日の前日まで。
      return { start: today, end: paydayCycleFor(today, payday).endOn };
    case 'month_end':
      return { start: today, end: lastDayOfMonth(today, 0) };
    case 'next_month_end':
      return { start: today, end: lastDayOfMonth(today, 1) };
  }
}

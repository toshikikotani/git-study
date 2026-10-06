/**
 * 目標(AI相談で決めた貯蓄目標・買い物目標、本人発案)の入力値検証と進捗計算。
 *
 * ── 進捗はなぜ自動計算しないか ──────────────────────────────
 * この目標のために「取り分けた」額を、収支全体(features/reports の
 * summarizeMonthlyIncomeExpense)から機械的に引き当てることはできない
 * (本人が複数の目標を並行して持てるし、返済に回した分と目標のために
 * 貯めた分は別物のため)。そのため current_amount_yen は本人が更新する
 * 前提で持つ(TASKS.md 参照)。
 */

import { daysBetween, type DateOnly } from '@/lib/date';
import { AppError } from '@/lib/errors';

export class GoalError extends AppError {}

/** 目標のタイトル。空文字・空白のみは拒否する。 */
export function assertGoalTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new GoalError('目標のタイトルを入力してください');
  }
  return trimmed;
}

/** 目標金額(円)。金額を持たない目標もあるため null 許容、指定するなら正の整数。 */
export function assertGoalTargetAmountYen(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new GoalError(`目標金額は1円以上の整数で指定してください: ${value}`);
  }
  return value;
}

/** 現在の進捗額(円)。0以上の整数。 */
export function assertGoalCurrentAmountYen(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new GoalError(`進捗額は0円以上の整数で指定してください: ${value}`);
  }
  return value;
}

export type GoalProgressInput = {
  targetAmountYen: number | null;
  currentAmountYen: number;
};

/**
 * 進捗率。目標金額が無い(null)場合は null(0%と誤読させない、savingsRateOf と
 * 同じ考え方)。1 を超えることがある(目標を超えて貯まった場合、良いことなので
 * 上限で切らない。表示側で切るかは Meter 等の呼び出し側の判断)。
 */
export function goalProgressRatio(goal: GoalProgressInput): number | null {
  if (goal.targetAmountYen === null) return null;
  return goal.currentAmountYen / goal.targetAmountYen;
}

/** 期限までの残り日数。期限が無ければ null。 */
export function daysUntilTarget(targetDate: DateOnly | null, today: DateOnly): number | null {
  if (targetDate === null) return null;
  return daysBetween(today, targetDate);
}

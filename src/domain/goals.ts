/**
 * 貯金目標(本人発案)の入力値検証。
 *
 * 貯まった額は手で入れず、収入 − 支出から自動で数え、期限の近い目標から順に
 * 割り当てる(domain/savings.ts、ADR-081)。以前は返済と貯金が別物だったため
 * 手入力にしていたが、借金をなくしたので自動にした。
 */

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

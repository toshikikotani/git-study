/**
 * 口座(カード)フォームの入力値検証(M6-1)。
 */

import { isValidDayOfMonth } from '@/lib/date';
import { AppError } from '@/lib/errors';

export class AccountError extends AppError {}

/** 口座名。空文字・空白のみは拒否する。 */
export function assertAccountName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new AccountError('口座名を入力してください');
  }
  return trimmed;
}

/** 締め日(1〜31)。銀行口座・現金には無いため任意入力。 */
export function assertClosingDay(value: number | null): number | null {
  if (value === null) return null;
  if (!isValidDayOfMonth(value)) {
    throw new AccountError(`締め日は1〜31の整数で指定してください: ${value}`);
  }
  return value;
}

/** 支払日(1〜31)。任意入力。 */
export function assertPaymentDay(value: number | null): number | null {
  if (value === null) return null;
  if (!isValidDayOfMonth(value)) {
    throw new AccountError(`支払日は1〜31の整数で指定してください: ${value}`);
  }
  return value;
}

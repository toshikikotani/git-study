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

/** 用途別の残高集計1件分。 */
export type PurposeBalance = {
  purpose: string;
  totalYen: number;
  accountCount: number;
};

/**
 * 口座の残高を用途(accounts.purpose)ごとに合算する(MoneyForward MEとの
 * 機能比較調査、issue #98)。
 *
 * クレジットカードは残高がマイナス(未払い残高)になりうるため、合計もマイナスを
 * そのまま許容する。並び順は合計額の大きい順(資産寄りの用途が先、負債寄りの
 * 用途は後ろに来る)。
 */
export function summarizeBalanceByPurpose(
  accounts: readonly { purpose: string; currentBalanceYen: number }[],
): PurposeBalance[] {
  const byPurpose = new Map<string, PurposeBalance>();

  for (const account of accounts) {
    const current = byPurpose.get(account.purpose) ?? {
      purpose: account.purpose,
      totalYen: 0,
      accountCount: 0,
    };
    current.totalYen += account.currentBalanceYen;
    current.accountCount += 1;
    byPurpose.set(account.purpose, current);
  }

  return [...byPurpose.values()].sort((a, b) => b.totalYen - a.totalYen);
}

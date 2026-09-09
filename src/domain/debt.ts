/**
 * 負債フォームの入力値検証(M1-2)。
 *
 * 金額(円)は domain/money.ts の assertYen/parseYen、年利のパーセント変換は
 * 同じく money.ts の formatAnnualRate/parseAnnualRate を使う。ここに置くのは
 * それ以外の、負債固有の入力(借入先名・返済日)だけ。
 */

import { isValidDayOfMonth } from '@/lib/date';

export class DebtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebtError';
  }
}

/** 借入先名。空文字・空白のみは拒否する。 */
export function assertLenderName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new DebtError('借入先を入力してください');
  }
  return trimmed;
}

/**
 * 返済日(1〜31 の日にち番号。DateOnly ではない)。
 * 29〜31 を指定した月に日が無ければ、計算側(domain/payoff.ts)が
 * 28 に丸めて扱う。ここでは範囲だけを見る。
 */
export function assertPaymentDay(value: number): number {
  if (!isValidDayOfMonth(value)) {
    throw new DebtError(`返済日は1〜31の整数で指定してください: ${value}`);
  }
  return value;
}

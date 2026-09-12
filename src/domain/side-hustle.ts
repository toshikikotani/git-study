/**
 * 副業トラッカーの検証と計算(P3-1、FR-40, FR-42)。
 */

export class SideHustleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SideHustleError';
  }
}

/** プロジェクト名。空文字・空白のみは拒否する。 */
export function assertProjectName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new SideHustleError('プロジェクト名を入力してください');
  }
  return trimmed;
}

/** 作業時間(分)。DB 制約(ck_side_work_minutes)と同じ範囲(1分〜24時間)。 */
export function assertWorkMinutes(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 1440) {
    throw new SideHustleError(`作業時間は1〜1440分の整数で入力してください: ${value}`);
  }
  return value;
}

/** 入金額。DB 制約(ck_side_incomes_amount)と同じく正の数。 */
export function assertIncomeAmountYen(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new SideHustleError(`入金額は正の整数で入力してください: ${value}`);
  }
  return value;
}

export type IncomeAllocation = {
  repaymentYen: number;
  investmentYen: number;
};

/**
 * FR-42:副業収入を返済:投資の比率で振り分ける(既定 7:3、
 * `app_settings.side_income_repayment_ratio`)。
 *
 * 端数は返済側に寄せる(投資額を先に丸め、返済額は差分で求める)ことで、
 * 常に repaymentYen + investmentYen = amountYen になる
 * (DB 制約 ck_side_incomes_alloc_sum を確実に満たす)。
 */
export function computeIncomeAllocation(
  amountYen: number,
  repaymentRatio: number,
): IncomeAllocation {
  if (!Number.isFinite(repaymentRatio) || repaymentRatio < 0 || repaymentRatio > 1) {
    throw new SideHustleError(`振り分け比率は0以上1以下で指定してください: ${repaymentRatio}`);
  }
  const investmentYen = Math.round(amountYen * (1 - repaymentRatio));
  const repaymentYen = amountYen - investmentYen;
  return { repaymentYen, investmentYen };
}

/**
 * FR-40:時給換算。作業時間の記録が無ければ(0分)換算できないため null。
 */
export function computeHourlyRateYen(totalMinutes: number, totalIncomeYen: number): number | null {
  if (totalMinutes <= 0) return null;
  return Math.round(totalIncomeYen / (totalMinutes / 60));
}

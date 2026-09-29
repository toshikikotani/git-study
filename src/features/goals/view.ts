/**
 * 目標(期間つきの支出目標、ADR-058)を家計簿・目標画面で見せる形に整える純粋関数。
 * 集計は家計簿と同じ domain/ledger.ts の summarizeLedger()(特別費・予定は除いた
 * ペースの値)を使い、画面ごとに足し直さない。DB には触れない。
 *
 * 追加はこの後のコミット(目標との連携)で行う。ここでは家計簿の内訳が使う型だけを持つ。
 */

/** 家計簿のジャンル内訳(目標期間の切り替え)で使う1行。 */
export type GoalBreakdownRow = {
  genreId: string | null;
  genreName: string;
  spentYen: number;
  /** 目標額。目標に無いジャンルは null(予算なし)。 */
  targetYen: number | null;
  /** 今日時点の理想ライン(目標を期間で均等に使った額)。 */
  idealYen: number | null;
};

import { budgetState, type BudgetState } from '@/domain/budget-state';

/**
 * カレンダーの各日に付ける、1日の目安に対する状態の点。
 * 目安(1日の目安 = 目標の合計 ÷ 期間の日数)に対して、その日の支出が
 * 80%未満=余裕、100%まで=注意、超えたら=超過。目安が無ければ null(点を付けない)。
 */
export function dayStatus(spentYen: number, dailyAllowanceYen: number | null): BudgetState | null {
  if (dailyAllowanceYen === null || dailyAllowanceYen <= 0) return null;
  return budgetState({ spentYen, budgetYen: dailyAllowanceYen });
}

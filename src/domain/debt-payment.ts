/**
 * 返済実績と計画の比較(FR-05, M1-6)。
 *
 * 「返済を記録する」こと自体(元本・利息の自動按分)は features/debts/store.ts
 * が担う(Supabase の現在残高を読む必要があるため、ここには置けない)。
 * ここは「計画どおりか」を判定する部分だけを、テストしやすい純粋関数として切り出す。
 */

import type { PayoffRow } from './payoff';

export type PlanActualDelta = {
  plannedBalanceYen: number;
  actualBalanceYen: number;
  /** 実績 - 計画。正なら計画より遅れている、負なら計画より進んでいる。 */
  deltaYen: number;
};

/**
 * 計画(simulateDebtPayoff の各月末残高)の paymentIndex 回目(1始まり)の残高と、
 * 実際の返済後残高を比べる。
 *
 * 計画がその回数より先に完済している(returns fewer rows than paymentIndex)場合は、
 * 計画上の残高を0円として扱う(計画どおりなら、その時点でもう完済しているはず)。
 */
export function computePlanActualDelta(
  planRows: readonly PayoffRow[],
  paymentIndex: number,
  actualBalanceYen: number,
): PlanActualDelta {
  const plannedBalanceYen =
    paymentIndex <= planRows.length ? planRows[paymentIndex - 1]!.closingBalanceYen : 0;

  return {
    plannedBalanceYen,
    actualBalanceYen,
    deltaYen: actualBalanceYen - plannedBalanceYen,
  };
}

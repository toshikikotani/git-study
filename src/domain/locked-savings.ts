/**
 * 確保した貯蓄。全画面がこの式だけを使う。
 * 手取りが無い月は計算しない。0円の収入として扱わない。
 *
 * 義務は、負債の最低返済と給料日の返済目標の大きい方。両方は引かない。
 * 積立は、給料日ルールのうち名前が投資・積立の固定額。残りを受け取るルールは貯蓄そのものなので引かない。
 */
export function lockedSavingsYen(input: {
  incomeYen: number;
  obligationYen: number;
  sinkingYen: number;
  scheduledYen: number;
  discretionaryCapYen: number;
}): number | null {
  if (input.incomeYen <= 0) return null;
  return (
    input.incomeYen -
    input.obligationYen -
    input.sinkingYen -
    input.scheduledYen -
    input.discretionaryCapYen
  );
}

export function obligationYen(debtMinimumYen: number, repaymentTargetYen: number): number {
  return Math.max(0, debtMinimumYen, repaymentTargetYen);
}

export function sinkingFromRules(
  rules: readonly { name: string; amountType: string; amountYen: number | null }[],
): number {
  return rules.reduce((sum, rule) => {
    if (rule.amountType !== 'fixed' || rule.amountYen === null || rule.amountYen <= 0) return sum;
    if (!/投資|積立/.test(rule.name)) return sum;
    return sum + rule.amountYen;
  }, 0);
}

export const MISSING_INCOME_NOTE = '手取りが未入力';

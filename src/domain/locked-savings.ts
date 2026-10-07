/**
 * 確保した貯蓄。全画面がこの式だけを使う。
 * 手取りが無い月は計算しない。0円の収入として扱わない。
 *
 * 積立は、給料日ルールのうち名前が投資・積立の固定額。「貯金へ」や残りを受け取るルールは
 * 貯蓄そのものなので引かない(借金の返済は ADR-077 でなくした)。
 */
export function lockedSavingsYen(input: {
  incomeYen: number;
  sinkingYen: number;
  scheduledYen: number;
  discretionaryCapYen: number;
}): number | null {
  if (input.incomeYen <= 0) return null;
  return input.incomeYen - input.sinkingYen - input.scheduledYen - input.discretionaryCapYen;
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

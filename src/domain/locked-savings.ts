/**
 * 確保した貯蓄。全画面がこの式だけを使う。
 * 手取りが無い月は計算しない。0円の収入として扱わない。
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

export const MISSING_INCOME_NOTE = '手取りが未入力';

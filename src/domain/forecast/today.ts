/**
 * 今日あと使える額(設計書 v3 3.1)。1日の上限(予算に収まるのが10回中8回になる額)から、
 * 今日もう使った額を引く。毎回モデルで出し直すので、使わなかった分は翌日以降の上限に戻る。
 */

export type TodayAllowance =
  | { kind: 'left'; capYen: number; spentYen: number; leftYen: number }
  | { kind: 'over'; capYen: number; spentYen: number; overYen: number };

export function todayAllowance(input: {
  /** 1日の上限(forecast.safeDailyAllowance)。予算が無ければ null。 */
  capYen: number | null;
  spentTodayYen: number;
}): TodayAllowance | null {
  if (input.capYen === null) return null;
  const left = input.capYen - input.spentTodayYen;
  return left >= 0
    ? { kind: 'left', capYen: input.capYen, spentYen: input.spentTodayYen, leftYen: left }
    : { kind: 'over', capYen: input.capYen, spentYen: input.spentTodayYen, overYen: -left };
}

/** 読み上げ・「音で聞く」の最初の一文(設計書 v3 3.10)。 */
export function todaySentence(t: TodayAllowance, format: (yen: number) => string): string {
  return t.kind === 'left'
    ? `今日あと${format(t.leftYen)}使えます。`
    : `今日は1日の上限を${format(t.overYen)}超えています。`;
}

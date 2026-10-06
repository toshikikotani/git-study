/**
 * 注意の設計(設計書 v3 3.2)。変えられて、当たりやすく、額の大きいものだけに注意を出す。
 *
 * - 定常型のジャンルで、目標を超える確率が50%以上、かつ中央での超過額が
 *   「1,000円」と「目標の10%」の大きい方以上
 * - 同時に出すのは2つまで(中央での超過額が大きい順)
 * - 検証で、注意の精度(出したうち実際に超えた割合)が70%未満の時点帯では出さない
 * - 決まっている額だけで目標を超えたときは、「超えた」(赤)として別に出す
 *
 * 画面・検証・評価がこの1つの関数を使う(注意の当たり方を、出したものと同じ規則で測る)。
 */

import type { ForecastPhase, SpendingType } from './types';

export const CAUTION_MIN_PROBABILITY = 0.5;
export const CAUTION_MIN_OVERSHOOT_YEN = 1000;
export const CAUTION_MIN_OVERSHOOT_RATIO = 0.1;
export const MAX_CAUTIONS = 2;
export const MIN_CAUTION_PRECISION = 0.7;
/** 精度で止めるのに要る、その時点帯で出した注意の数。 */
export const MIN_CAUTIONS_FOR_PRECISION = 5;

export type CautionInput = {
  categoryId: string;
  type: SpendingType;
  targetYen: number | null;
  /** 中央の着地(決まっている額 + 残りの中央)。 */
  medianYen: number;
  baseYen: number;
  exceedance: number | null;
};

export type Caution = {
  categoryId: string;
  /** 'over':決まっている額だけで目標を超えた。'likely':このままだと超える見込み。 */
  kind: 'over' | 'likely';
  overshootYen: number;
  probability: number;
};

/** 時点帯ごとの、注意の精度(検証から)。出した数と、実際に超えた数。 */
export type CautionPrecision = Partial<Record<ForecastPhase, { issued: number; hits: number }>>;

export function cautionsFor(
  rows: readonly CautionInput[],
  options: { phase?: ForecastPhase; precision?: CautionPrecision | null } = {},
): Caution[] {
  const over: Caution[] = [];
  const likely: Caution[] = [];
  for (const row of rows) {
    if (row.targetYen === null || row.targetYen <= 0) continue;
    if (row.baseYen > row.targetYen) {
      over.push({
        categoryId: row.categoryId,
        kind: 'over',
        overshootYen: row.baseYen - row.targetYen,
        probability: 1,
      });
      continue;
    }
    if (row.type !== 'steady' || row.exceedance === null) continue;
    const overshoot = row.medianYen - row.targetYen;
    const minimum = Math.max(
      CAUTION_MIN_OVERSHOOT_YEN,
      row.targetYen * CAUTION_MIN_OVERSHOOT_RATIO,
    );
    if (row.exceedance >= CAUTION_MIN_PROBABILITY && overshoot >= minimum) {
      likely.push({
        categoryId: row.categoryId,
        kind: 'likely',
        overshootYen: overshoot,
        probability: row.exceedance,
      });
    }
  }
  const stats = options.phase ? options.precision?.[options.phase] : undefined;
  const muted =
    stats !== undefined &&
    stats.issued >= MIN_CAUTIONS_FOR_PRECISION &&
    stats.hits / stats.issued < MIN_CAUTION_PRECISION;
  const picked = muted
    ? []
    : likely.sort((a, b) => b.overshootYen - a.overshootYen).slice(0, MAX_CAUTIONS);
  return [...over.sort((a, b) => b.overshootYen - a.overshootYen), ...picked];
}

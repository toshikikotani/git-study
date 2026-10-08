/**
 * ジャンル別の着地の行(レポートのカード)。予測の数字に、範囲から外した額(特別費)を足して、
 * 着地が「使った額」を下回って見えないようにする(設計書 v3 2.2 の1)。残りの見込みが無い
 * ジャンルは、幅ではなく「確定」「予測を止めています」と言葉で出す(同 9)。
 *
 * 行は2つに分ける(設計書 v3 3.3):「変えられる支出」(定常型・まとまり型で、この先の見込みが
 * あるもの。中央での超過額の大きい順)と「決まった支出」(確定・予測を止めた・決まった型)。
 * 注意は cautionsFor(3.2)で決める。目標は特別費を数えないので、注意は外した額を足す前の値で見る。
 */

import { cautionsFor, type Caution, type CautionPrecision } from './caution';
import type { Forecast, SpendingType } from './types';

export type LandingRowStatus = 'forecast' | 'settled' | 'closed';
export type LandingRowGroup = 'changeable' | 'fixed';

export type LandingRow = {
  genreId: string;
  name: string;
  /** すでに決まっている額(実績・予定・固定費。範囲から外した額も含む)。 */
  baseYen: number;
  p10: number;
  p50: number;
  p90: number;
  targetYen: number | null;
  exceedance: number | null;
  /** 範囲から外した額(目標の対象外の特別費)。0なら無し。 */
  excludedYen: number;
  status: LandingRowStatus;
  type: SpendingType;
  group: LandingRowGroup;
  /** 出す注意(無ければ null)。 */
  caution: Caution | null;
  /** 残りの期間で、このジャンルを週1回減らしたときに減る額の目安(定常型で、回数が足りるときだけ)。 */
  cutPerWeekYen: number | null;
};

export function landingRowsFrom(input: {
  forecast: Forecast;
  excludedByCategory?: ReadonlyMap<string, number>;
  /** 「予測を止める」にしたジャンル。 */
  closedGenreIds?: ReadonlySet<string>;
  /** 検証で測った注意の精度(低い時点帯では注意を止める)。 */
  cautionPrecision?: CautionPrecision | null;
  limit?: number;
}): LandingRow[] {
  const excluded = input.excludedByCategory ?? new Map<string, number>();
  const cautions = new Map(
    cautionsFor(
      input.forecast.byCategory.map((c) => ({
        categoryId: c.categoryId,
        type: c.type,
        targetYen: c.targetYen,
        medianYen: c.landing.p50,
        baseYen: c.baseYen,
        exceedance: c.exceedance,
      })),
      { phase: input.forecast.phase, precision: input.cautionPrecision ?? null },
    ).map((c) => [c.categoryId, c]),
  );
  const weeks = input.forecast.remainingDays / 7;
  const rows = input.forecast.byCategory
    .filter((c) => c.landing.p90 > 0 || (excluded.get(c.categoryId) ?? 0) > 0)
    .map((c) => {
      const extra = excluded.get(c.categoryId) ?? 0;
      const settled = c.landing.p90 <= c.baseYen;
      // 「これ以上は使わない」にしたジャンルは、見込みがあっても「止めた」として出す(守れたら・
      // いつもの守り方なら の2つを出す。設計書 v3 4.7)。
      const status: LandingRowStatus = input.closedGenreIds?.has(c.categoryId)
        ? 'closed'
        : settled
          ? 'settled'
          : 'forecast';
      const row: LandingRow = {
        genreId: c.categoryId,
        name: c.categoryName,
        baseYen: c.baseYen + extra,
        p10: c.landing.p10 + extra,
        p50: c.landing.p50 + extra,
        p90: c.landing.p90 + extra,
        targetYen: c.targetYen,
        exceedance: c.exceedance,
        excludedYen: extra,
        status,
        type: c.type,
        group: status === 'forecast' && c.type !== 'fixed' ? 'changeable' : 'fixed',
        caution: cautions.get(c.categoryId) ?? null,
        cutPerWeekYen:
          c.type === 'steady' && weeks >= 1 && c.expectedCount >= weeks * 1.5
            ? Math.round(c.meanYen * Math.min(1, weeks / c.expectedCount))
            : null,
      };
      return { row, overshoot: c.targetYen === null ? -Infinity : c.landing.p50 - c.targetYen };
    })
    .sort((a, b) => b.overshoot - a.overshoot || b.row.p50 - a.row.p50)
    .slice(0, input.limit ?? Number.MAX_SAFE_INTEGER);
  return rows.map(({ row }) => row);
}

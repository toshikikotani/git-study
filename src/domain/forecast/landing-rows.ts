/**
 * ジャンル別の着地の行(レポートのカード)。予測の数字に、範囲から外した額(特別費)を足して、
 * 着地が「使った額」を下回って見えないようにする(設計書 v3 2.2 の1)。残りの見込みが無い
 * ジャンルは、幅ではなく「確定」「予測を止めています」と言葉で出す(同 9)。
 */

import type { Forecast } from './types';

export type LandingRowStatus = 'forecast' | 'settled' | 'closed';

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
};

export function landingRowsFrom(input: {
  forecast: Forecast;
  excludedByCategory?: ReadonlyMap<string, number>;
  /** 「予測を止める」にしたジャンル。 */
  closedGenreIds?: ReadonlySet<string>;
  limit?: number;
}): LandingRow[] {
  const excluded = input.excludedByCategory ?? new Map<string, number>();
  return input.forecast.byCategory
    .filter((c) => c.landing.p90 > 0 || (excluded.get(c.categoryId) ?? 0) > 0)
    .map((c): LandingRow => {
      const extra = excluded.get(c.categoryId) ?? 0;
      const settled = c.landing.p90 <= c.baseYen;
      return {
        genreId: c.categoryId,
        name: c.categoryName,
        baseYen: c.baseYen + extra,
        p10: c.landing.p10 + extra,
        p50: c.landing.p50 + extra,
        p90: c.landing.p90 + extra,
        targetYen: c.targetYen,
        exceedance: c.exceedance,
        excludedYen: extra,
        status: !settled
          ? 'forecast'
          : input.closedGenreIds?.has(c.categoryId)
            ? 'closed'
            : 'settled',
      };
    })
    .sort((a, b) => b.p50 - a.p50)
    .slice(0, input.limit ?? 8);
}

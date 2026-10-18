/**
 * ホームに出す「気をつけたいカテゴリ」(本人の案、ADR-117)。
 *
 * 以前はカテゴリの一覧で「ホームに表示」を1つずつスイッチで選んでいた。ホームに出したいのは、ふつう
 * 「いま気をつけたいカテゴリ」で、それは月によって変わるため、自分で入れ替える人はほとんどいない。
 * いまは目標のあるカテゴリから自動で選ぶ:使った額で目標をこえた → このままだとこえそう →
 * 目標の8割をこえた、の順に最大3つ。固定費(決まった型・予測を止めたカテゴリ)は出さない
 * (毎月ほぼ同じ額で、いま気をつけることがない)。「こえそう」は分析の進み具合と同じ決め方。
 */

import type { LandingRow } from './landing-rows';
import type { ForecastCategoryBand } from './types';

/** over:使った額で目標をこえた。risk:このままだとこえそう。near:目標の8割をこえた。 */
export type WatchTone = 'over' | 'risk' | 'near';

export type WatchCategory = {
  genreId: string;
  name: string;
  /** 期間のはじめから今日までに使った額。 */
  spentYen: number;
  targetYen: number;
  /** 期間の終わりの見込み(中央)。 */
  p50: number;
  tone: WatchTone;
};

export const WATCH_LIMIT = 3;
/** 目標のこの割合をこえたら出す。 */
export const WATCH_NEAR_RATIO = 0.8;

const ORDER: Record<WatchTone, number> = { over: 0, risk: 1, near: 2 };

export function watchCategories(input: {
  /** 予測の着地の行(landingRowsFrom、注意つき)。 */
  rows: readonly LandingRow[];
  byCategory: readonly ForecastCategoryBand[];
  /** 予測を止めたカテゴリ。 */
  closedGenreIds?: ReadonlySet<string>;
  limit?: number;
}): WatchCategory[] {
  const spent = new Map(input.byCategory.map((c) => [c.categoryId, c.actualYen]));
  const out: { category: WatchCategory; weight: number }[] = [];
  for (const row of input.rows) {
    const target = row.targetYen;
    if (target === null || target <= 0) continue;
    if (row.group === 'fixed' || input.closedGenreIds?.has(row.genreId)) continue;
    const spentYen = spent.get(row.genreId) ?? 0;
    const tone: WatchTone | null =
      spentYen > target
        ? 'over'
        : row.caution !== null || row.p50 > target
          ? 'risk'
          : spentYen >= target * WATCH_NEAR_RATIO
            ? 'near'
            : null;
    if (tone === null) continue;
    // 同じ段の中では、こえた額・こえそうな額・使った割合の大きい順。
    const weight =
      tone === 'over' ? spentYen - target : tone === 'risk' ? row.p50 - target : spentYen / target;
    out.push({
      category: {
        genreId: row.genreId,
        name: row.name,
        spentYen,
        targetYen: target,
        p50: row.p50,
        tone,
      },
      weight,
    });
  }
  return out
    .sort((a, b) => ORDER[a.category.tone] - ORDER[b.category.tone] || b.weight - a.weight)
    .slice(0, input.limit ?? WATCH_LIMIT)
    .map((w) => w.category);
}

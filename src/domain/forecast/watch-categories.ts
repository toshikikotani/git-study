/**
 * ホームに出す「気をつけたいカテゴリ」(本人の案、ADR-117)。
 *
 * 以前はカテゴリの一覧で「ホームに表示」を1つずつスイッチで選んでいた。ホームに出したいのは、ふつう
 * 「いま気をつけたいカテゴリ」で、それは月によって変わるため、自分で入れ替える人はほとんどいない。
 * いまは目標のあるカテゴリから自動で選ぶ:使った額で目標をこえた → このままだとこえそう →
 * 目標の8割をこえた、の順(ホームは最大3つ)。分析 › 目標の「気をつけたい」も同じ決め方(ADR-127)。固定費(決まった型・予測を止めたカテゴリ)は出さない
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

/**
 * 1つのカテゴリが「気をつけたい」か(今日と分析 › 目標で同じ決め方、ADR-127)。固定費(決まった型・
 * 予測を止めたカテゴリ)と、目標のないカテゴリは null。
 */
export function watchToneOf(input: {
  spentYen: number;
  targetYen: number | null;
  /** 期間の終わりの見込み(中央)。 */
  p50: number | null;
  /** 予測の注意(このままだとこえそう)。 */
  caution: unknown;
  fixed: boolean;
}): WatchTone | null {
  const target = input.targetYen;
  if (target === null || target <= 0 || input.fixed) return null;
  if (input.spentYen > target) return 'over';
  if (input.caution !== null || (input.p50 !== null && input.p50 > target)) return 'risk';
  if (input.spentYen >= target * WATCH_NEAR_RATIO) return 'near';
  return null;
}

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
    const spentYen = spent.get(row.genreId) ?? 0;
    const tone = watchToneOf({
      spentYen,
      targetYen: row.targetYen,
      p50: row.p50,
      caution: row.caution,
      fixed: row.group === 'fixed' || (input.closedGenreIds?.has(row.genreId) ?? false),
    });
    if (tone === null) continue;
    const target = row.targetYen!;
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

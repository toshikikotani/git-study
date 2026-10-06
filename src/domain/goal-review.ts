/**
 * 目標期間が終わったあとの振り返り:ジャンルごとの目標と実績、うまくいった点1つ、
 * 次に見直すジャンル1つ。「この結果で次の目標を作る」ための次の目標案も決める。
 * 叱らず、数字とできたことを先に見せる。
 */

import { formatYen } from '@/domain/money';
import { PLAN_ROUNDING_YEN } from '@/domain/spending-plan';

export type ReviewRow = {
  genreId: string;
  genreName: string;
  targetYen: number;
  actualYen: number;
  /** 実績 − 目標(正なら目標を超えた)。 */
  diffYen: number;
  met: boolean;
};

export type GoalReview = {
  rows: ReviewRow[];
  targetYen: number;
  actualYen: number;
  goodPoint: string;
  reviewGenre: { genreId: string; genreName: string; reason: string } | null;
};

export function buildGoalReview(input: {
  items: readonly { genreId: string; genreName: string; targetYen: number }[];
  /** ジャンルごとの実績(特別費・予定を除く)。 */
  actualByGenre: ReadonlyMap<string, number>;
}): GoalReview {
  const rows: ReviewRow[] = input.items
    .filter((i) => i.targetYen > 0)
    .map((i) => {
      const actualYen = input.actualByGenre.get(i.genreId) ?? 0;
      return {
        genreId: i.genreId,
        genreName: i.genreName,
        targetYen: i.targetYen,
        actualYen,
        diffYen: actualYen - i.targetYen,
        met: actualYen <= i.targetYen,
      };
    });
  const targetYen = rows.reduce((a, r) => a + r.targetYen, 0);
  const actualYen = rows.reduce((a, r) => a + r.actualYen, 0);

  const met = rows.filter((r) => r.met).sort((a, b) => a.diffYen - b.diffYen);
  let goodPoint: string;
  if (rows.length === 0) {
    goodPoint = '目標のあるジャンルがありませんでした。';
  } else if (met.length === rows.length) {
    goodPoint = `すべてのジャンルが目標内に収まりました(合計 ${formatYen(targetYen - actualYen, { sign: 'never' })} の余り)。`;
  } else if (met.length > 0) {
    const best = met[0]!;
    goodPoint = `${best.genreName}は目標より${formatYen(-best.diffYen, { sign: 'never' })}少なく収まりました。`;
  } else {
    const closest = [...rows].sort(
      (a, b) => a.actualYen / a.targetYen - b.actualYen / b.targetYen,
    )[0]!;
    goodPoint = `${closest.genreName}が目標に一番近い結果でした。`;
  }

  const over = rows.filter((r) => !r.met).sort((a, b) => b.diffYen - a.diffYen)[0];
  let reviewGenre: GoalReview['reviewGenre'] = null;
  if (over) {
    reviewGenre = {
      genreId: over.genreId,
      genreName: over.genreName,
      reason: `目標より${formatYen(over.diffYen, { sign: 'never' })}多く使いました`,
    };
  } else if (rows.length > 0) {
    const tight = [...rows].sort(
      (a, b) => b.actualYen / b.targetYen - a.actualYen / a.targetYen,
    )[0]!;
    reviewGenre = {
      genreId: tight.genreId,
      genreName: tight.genreName,
      reason: `目標の${Math.round((tight.actualYen / tight.targetYen) * 100)}%まで使いました(いちばん余裕が少ないジャンル)`,
    };
  }
  return { rows, targetYen, actualYen, goodPoint, reviewGenre };
}

function round100(yen: number): number {
  return Math.round(yen / PLAN_ROUNDING_YEN) * PLAN_ROUNDING_YEN;
}

/**
 * 実績を反映した次の目標案(ジャンルごと)。少しずつ改善する:
 *   - 目標を超えた:目標と実績の中間(超えた分の半分だけ戻す)
 *   - 目標より大きく下回った(実績が目標の80%未満):実績の5%増しまで現実に合わせる
 *   - それ以外:同じ目標を続ける
 * 期間の長さが変わるときは periodScale(次の日数 ÷ 前の日数)で比例させる。
 */
export function nextPlanTargets(review: GoalReview, periodScale = 1): Map<string, number> {
  const next = new Map<string, number>();
  for (const r of review.rows) {
    let yen: number;
    if (!r.met) yen = r.targetYen + (r.actualYen - r.targetYen) / 2;
    else if (r.actualYen < r.targetYen * 0.8) yen = Math.max(r.actualYen * 1.05, 0);
    else yen = r.targetYen;
    next.set(r.genreId, Math.max(round100(yen * periodScale), 0));
  }
  return next;
}

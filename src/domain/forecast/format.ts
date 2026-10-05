/**
 * 確率の見せ方。試行の数には限りがあるので、0%・100% とは言い切らない(「99%以上」「1%未満」)。
 */
export function formatProbability(p: number): string {
  if (p >= 0.995) return '99%以上';
  if (p < 0.005) return '1%未満';
  return `${Math.round(p * 100)}%`;
}

/** 「注意」として目立たせる、目標・予算を超える確率の下限。 */
export const CAUTION_EXCEEDANCE = 0.2;

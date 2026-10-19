import { probabilityAt, type ForecastDistribution } from './distribution';

/**
 * 日ごとの予測の色に使う、等しい金額幅の区間とその確率。
 * [lowYen, highYen) (最後の区間だけ上端を含む)。同額に集中するときは幅0の点になる。
 * 確率は元の補正済み分布のまま。描画範囲内だけで1へ正規化しない。
 */
export type PathDensityBin = {
  lowYen: number;
  highYen: number;
  probability: number;
};

/**
 * p10〜p90の帯を等しい金額幅で分ける。中央が濃いと仮定せず、各区間の試行の密度を使う。
 * 金額は整数円なので、上端未満の確率は ceil(上端)-1 円以下として求める。
 * 同額試行が多い場合、帯内の確率は80%を超えることもある。
 */
export function pathDensity(
  distribution: ForecastDistribution,
  options: { lowYen: number; highYen: number; bins?: number },
): PathDensityBin[] {
  const { lowYen, highYen } = options;
  if (
    distribution.amounts.length === 0 ||
    !Number.isFinite(lowYen) ||
    !Number.isFinite(highYen) ||
    highYen < lowYen
  )
    return [];

  if (highYen === lowYen) {
    const probability =
      probabilityAt(distribution, highYen) - probabilityAt(distribution, Math.ceil(lowYen) - 1);
    return [{ lowYen, highYen, probability: Math.max(0, probability) }];
  }

  // 1円より狭い区間を乱立させない。同額試行は、境界をまたいで二重に数えない。
  const count = Math.min(
    Math.ceil(highYen - lowYen),
    Math.max(1, Math.min(100, Math.floor(options.bins ?? 16) || 1)),
  );
  let previous = probabilityAt(distribution, Math.ceil(lowYen) - 1);
  return Array.from({ length: count }, (_, i) => {
    const from = lowYen + ((highYen - lowYen) * i) / count;
    const to = i === count - 1 ? highYen : lowYen + ((highYen - lowYen) * (i + 1)) / count;
    const next = probabilityAt(distribution, i === count - 1 ? to : Math.ceil(to) - 1);
    const probability = Math.max(0, next - previous);
    previous = next;
    return { lowYen: from, highYen: to, probability };
  });
}

/**
 * ジャンル月次の統計予測。
 * 完了月だけを使い、直線回帰の点予測と80%予測区間を出す。
 * 今月は途中なので、当てはめには入れない。
 */

export type GenreForecast = {
  genreName: string;
  months: number;
  meanYen: number;
  sdYen: number;
  slopeYen: number;
  pointYen: number;
  lowYen: number;
  highYen: number;
  latestYen: number;
  zScore: number;
  saveYen: number;
};

type Input = {
  monthKeys: readonly string[];
  currentMonthKey: string;
  categories: readonly { id: string; name: string }[];
  rows: readonly { monthKey: string; categoryId: string; spentYen: number }[];
};

export function forecastGenre(input: Input): GenreForecast | null {
  const historyKeys = input.monthKeys.filter((key) => key < input.currentMonthKey);
  if (historyKeys.length < 2) return null;
  let best: GenreForecast | null = null;
  for (const category of input.categories) {
    const series = historyKeys.map((key) =>
      input.rows
        .filter((row) => row.categoryId === category.id && row.monthKey === key)
        .reduce((sum, row) => sum + row.spentYen, 0),
    );
    if (series.every((yen) => yen === 0)) continue;
    const forecast = fit(category.name, series);
    if (best === null || forecast.saveYen > best.saveYen) best = forecast;
  }
  return best;
}

function fit(genreName: string, series: readonly number[]): GenreForecast {
  const n = series.length;
  const mean = series.reduce((sum, yen) => sum + yen, 0) / n;
  const variance = series.reduce((sum, yen) => sum + (yen - mean) ** 2, 0) / Math.max(1, n - 1);
  const sd = Math.sqrt(variance);
  const xBar = (n - 1) / 2;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (i - xBar) ** 2;
    sxy += (i - xBar) * ((series[i] ?? 0) - mean);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = mean - slope * xBar;
  const nextX = n;
  const point = Math.max(0, intercept + slope * nextX);
  const sse = series.reduce((sum, yen, i) => sum + (yen - (intercept + slope * i)) ** 2, 0);
  const fitted = n > 2 ? Math.sqrt(sse / (n - 2)) : sd;
  const residual = Math.max(fitted, sd * 0.5, 1);
  const leverage = 1 + 1 / n + (nextX - xBar) ** 2 / Math.max(sxx, 1);
  const margin = 1.2816 * residual * Math.sqrt(leverage);
  const latest = series[n - 1] ?? 0;
  const zScore = sd === 0 ? 0 : (latest - mean) / sd;
  return {
    genreName,
    months: n,
    meanYen: Math.round(mean),
    sdYen: Math.round(sd),
    slopeYen: Math.round(slope),
    pointYen: Math.round(point),
    lowYen: Math.round(Math.max(0, point - margin)),
    highYen: Math.round(point + margin),
    latestYen: latest,
    zScore: Math.round(zScore * 10) / 10,
    saveYen: Math.max(0, Math.round(latest - mean)),
  };
}

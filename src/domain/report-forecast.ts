/**
 * レポートの支出予測(要求仕様 v2)。
 * 完了月だけを学習し、候補のうち隠し検証の誤差が小さいものを採用する。
 * 残差が0の直線、完了月4未満の回帰、的中しない区間は出さない。
 */

export type HistoryPoint = { monthKey: string; yen: number };

export type GenreForecast = {
  genreId: string;
  genreName: string;
  history: HistoryPoint[];
  pointYen: number;
  lowYen: number | null;
  highYen: number | null;
  showBand: boolean;
  intermittent: boolean;
  saveYen: number | null;
  hitCount: number;
  holdoutCount: number;
  errorYen: number;
  scheduledYen: number;
};

export type ReportForecast = {
  genres: GenreForecast[];
  overallYen: number | null;
  overallUsesDirect: boolean;
};

type Input = {
  monthKeys: readonly string[];
  currentMonthKey: string;
  categories: readonly { id: string; name: string }[];
  rows: readonly { monthKey: string; categoryId: string; spentYen: number }[];
  scheduledByGenre?: Readonly<Record<string, number>>;
  elapsedDays?: number;
};

const Z90 = 1.645;

export function forecastReport(input: Input): ReportForecast {
  const historyKeys = input.monthKeys.filter((key) => key < input.currentMonthKey);
  const genres = input.categories
    .map((category) =>
      forecastOne(
        category.id,
        category.name,
        historyKeys,
        historyKeys.map((key) => amount(input.rows, category.id, key)),
        input.scheduledByGenre?.[category.id] ?? 0,
      ),
    )
    .filter((genre) => genre.history.some((point) => point.yen > 0))
    .sort((a, b) => b.errorYen - a.errorYen);
  const summed = genres.reduce((sum, genre) => sum + genre.pointYen, 0);
  const totalSeries = historyKeys.map((key) =>
    input.categories.reduce((sum, category) => sum + amount(input.rows, category.id, key), 0),
  );
  const direct = forecastOne('all', '全体', historyKeys, totalSeries, 0);
  const overallUsesDirect =
    direct.pointYen > 0 && summed > 0 && Math.abs(summed - direct.pointYen) / direct.pointYen > 0.1;
  return {
    genres,
    overallYen: genres.length === 0 ? null : overallUsesDirect ? direct.pointYen : summed,
    overallUsesDirect,
  };
}

function forecastOne(
  genreId: string,
  genreName: string,
  keys: readonly string[],
  series: readonly number[],
  scheduledYen: number,
): GenreForecast {
  const history = keys.map((monthKey, index) => ({ monthKey, yen: series[index] ?? 0 }));
  const n = series.length;
  const zeros = series.filter((yen) => yen === 0).length;
  const intermittent = n > 0 && zeros / n > 0.5;
  const selected = intermittent ? intermittentModel(series) : selectModel(series);
  const checked = checkBands(series, intermittent);
  const pointYen = Math.max(0, selected.point + scheduledYen);
  const showBand = !intermittent && checked.holdoutCount >= 3 && checked.hitCount >= 2;
  const latest = series[n - 1] ?? 0;
  const saveYen = latest > selected.point ? Math.round(latest - selected.point) : null;
  return {
    genreId,
    genreName,
    history,
    pointYen: Math.round(pointYen),
    lowYen: showBand
      ? Math.round(Math.max(0, selected.point - selected.margin + scheduledYen))
      : null,
    highYen: showBand ? Math.round(selected.point + selected.margin + scheduledYen) : null,
    showBand,
    intermittent,
    saveYen,
    hitCount: checked.hitCount,
    holdoutCount: checked.holdoutCount,
    errorYen: selected.error,
    scheduledYen,
  };
}

function selectModel(series: readonly number[]): { point: number; margin: number; error: number } {
  const n = series.length;
  const candidates: Array<ReturnType<typeof lineModel>> = [medianModel(series), mean3(series)];
  if (n >= 4) {
    const line = lineModel(series);
    if (line.residual > 0) candidates.push(line);
  }
  const scored = candidates.map((model) => ({ ...model, error: holdoutError(series, model.kind) }));
  scored.sort((a, b) => a.error - b.error);
  return scored[0] ?? medianModel(series);
}

function intermittentModel(series: readonly number[]): {
  point: number;
  margin: number;
  error: number;
} {
  const hits = series.filter((yen) => yen > 0);
  const rate = series.length === 0 ? 0 : hits.length / series.length;
  const mid = median(hits);
  return { point: rate * mid, margin: 0, error: holdoutError(series, 'median') };
}

function checkBands(
  series: readonly number[],
  intermittent: boolean,
): { hitCount: number; holdoutCount: number } {
  if (intermittent || series.length < 4) return { hitCount: 0, holdoutCount: 0 };
  let hitCount = 0;
  let holdoutCount = 0;
  const start = Math.max(3, series.length - 3);
  for (let i = start; i < series.length; i += 1) {
    const train = series.slice(0, i);
    const model = selectModel(train);
    holdoutCount += 1;
    const actual = series[i] ?? 0;
    if (actual >= model.point - model.margin && actual <= model.point + model.margin) hitCount += 1;
  }
  return { hitCount, holdoutCount };
}

function holdoutError(series: readonly number[], kind: 'median' | 'mean3' | 'line'): number {
  if (series.length < 2) return Number.POSITIVE_INFINITY;
  const train = series.slice(0, -1);
  const actual = series[series.length - 1] ?? 0;
  const point =
    kind === 'mean3'
      ? mean3(train).point
      : kind === 'line' && train.length >= 4
        ? lineModel(train).point
        : median(train);
  return Math.abs(point - actual);
}

function medianModel(series: readonly number[]) {
  const point = median(series);
  return {
    kind: 'median' as const,
    point,
    margin: Z90 * mad(series, point),
    error: 0,
    residual: 1,
  };
}
function mean3(series: readonly number[]) {
  const tail = series.slice(-3);
  const point = tail.reduce((sum, yen) => sum + yen, 0) / Math.max(1, tail.length);
  return { kind: 'mean3' as const, point, margin: Z90 * sd(tail), error: 0, residual: 1 };
}
function lineModel(series: readonly number[]) {
  const n = series.length;
  const xBar = (n - 1) / 2;
  const yBar = series.reduce((sum, yen) => sum + yen, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (i - xBar) ** 2;
    sxy += (i - xBar) * ((series[i] ?? 0) - yBar);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = yBar - slope * xBar;
  const sse = series.reduce((sum, yen, i) => sum + (yen - (intercept + slope * i)) ** 2, 0);
  const residual = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  const nextX = n;
  const leverage = 1 + 1 / n + (nextX - xBar) ** 2 / Math.max(sxx, 1);
  return {
    kind: 'line' as const,
    point: Math.max(0, intercept + slope * nextX),
    margin: Z90 * residual * Math.sqrt(leverage),
    error: 0,
    residual,
  };
}

function amount(rows: Input['rows'], id: string, key: string): number {
  return rows
    .filter((row) => row.categoryId === id && row.monthKey === key)
    .reduce((sum, row) => sum + row.spentYen, 0);
}
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}
function sd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, yen) => sum + yen, 0) / values.length;
  return Math.sqrt(values.reduce((sum, yen) => sum + (yen - mean) ** 2, 0) / (values.length - 1));
}
function mad(values: readonly number[], center: number): number {
  return median(values.map((yen) => Math.abs(yen - center))) || sd(values) || 1;
}

export type ForecastVerdict = 'unknown' | 'unreachable' | 'on_track' | 'tight' | 'over';

export type GenreForecast = {
  medianYen: number | null;
  lowYen: number | null;
  highYen: number | null;
  verdict: ForecastVerdict;
  label: string;
  dailyCapYen: number | null;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function quantile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index]!;
}

function round100(yen: number): number {
  return Math.max(0, Math.round(yen / 100) * 100);
}

/** 今の支出と直近の行動から、期間末の着地を出す。モデルは呼ばない。 */
export function forecastGenre(input: {
  spentYen: number;
  scheduledYen: number;
  recentDaily: readonly number[];
  remainingDays: number;
  targetYen: number;
}): GenreForecast {
  const spendDays = input.recentDaily.filter((yen) => yen > 0);
  if (input.recentDaily.length < 7 || spendDays.length < 4) {
    return {
      medianYen: null,
      lowYen: null,
      highYen: null,
      verdict: 'unknown',
      label: 'まだ判断できない。支出のあった日が少ない。',
      dailyCapYen: null,
    };
  }
  const pace = median(spendDays);
  const lowPace = quantile(spendDays, 0.1);
  const highPace = quantile(spendDays, 0.9);
  const days = Math.max(input.remainingDays, 0);
  const base = input.spentYen + input.scheduledYen;
  const medianYen = round100(base + pace * days);
  const lowYen = round100(base + lowPace * days);
  const highYen = round100(base + highPace * days);
  const cap =
    days > 0 && input.targetYen > base ? round100((input.targetYen - base) / days) : null;
  const dailyCapYen = cap !== null && cap >= pace / 2 ? cap : null;

  if (input.scheduledYen >= input.targetYen && input.targetYen > 0) {
    return {
      medianYen,
      lowYen,
      highYen,
      verdict: 'unreachable',
      label: '届かない。確定の支払いだけで目標を超える。',
      dailyCapYen: null,
    };
  }
  if (medianYen <= input.targetYen && highYen <= input.targetYen) {
    return {
      medianYen,
      lowYen,
      highYen,
      verdict: 'on_track',
      label: 'このままで届きそう。',
      dailyCapYen,
    };
  }
  if (medianYen <= input.targetYen) {
    return {
      medianYen,
      lowYen,
      highYen,
      verdict: 'tight',
      label: '中央では届く。上振れすると超える。',
      dailyCapYen,
    };
  }
  return {
    medianYen,
    lowYen,
    highYen,
    verdict: 'over',
    label: `このままだと目標ではなく ${medianYen.toLocaleString('ja-JP')} 円ぐらいで着く。`,
    dailyCapYen,
  };
}

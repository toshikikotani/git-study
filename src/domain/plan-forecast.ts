export type ForecastVerdict = 'unknown' | 'unreachable' | 'on_track' | 'tight' | 'over';

export type GenreForecast = {
  medianYen: number | null;
  lowYen: number | null;
  highYen: number | null;
  verdict: ForecastVerdict;
  label: string;
  dailyCapYen: number | null;
};

function round100(yen: number): number {
  return Math.max(0, Math.round(yen / 100) * 100);
}

/**
 * 今期の支出と、1日あたりの中央値から着地を出す。
 * 幅は直近ペースの 0.6〜1.6 倍。正規分布は使わない。
 */
export function forecastFromPace(input: {
  spentYen: number;
  scheduledYen: number;
  paceYen: number;
  observedDays: number;
  remainingDays: number;
  targetYen: number;
}): GenreForecast {
  if (input.observedDays < 7 || input.paceYen <= 0) {
    return {
      medianYen: null,
      lowYen: null,
      highYen: null,
      verdict: 'unknown',
      label: 'まだ判断できない。このジャンルの支出が少ない。',
      dailyCapYen: null,
    };
  }
  const days = Math.max(input.remainingDays, 0);
  const base = input.spentYen + input.scheduledYen;
  const medianYen = round100(base + input.paceYen * days);
  const lowYen = round100(base + input.paceYen * 0.6 * days);
  const highYen = round100(base + input.paceYen * 1.6 * days);
  const cap =
    days > 0 && input.targetYen > base ? round100((input.targetYen - base) / days) : null;
  const dailyCapYen = cap !== null && cap >= input.paceYen / 2 ? cap : null;

  if (input.scheduledYen > 0 && input.scheduledYen >= input.targetYen) {
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
    label: `このままだと ${medianYen.toLocaleString('ja-JP')} 円ぐらいで着く。`,
    dailyCapYen,
  };
}

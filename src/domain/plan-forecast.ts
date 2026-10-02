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

/** 今期の支出、残りの予定、直近ペースから着地を出す。 */
export function forecastFromPace(input: {
  spentYen: number;
  scheduledYen: number;
  paceYen: number;
  observedDays: number;
  remainingDays: number;
  targetYen: number;
}): GenreForecast {
  const scheduledNote =
    input.scheduledYen > 0 ? `予定 ${input.scheduledYen.toLocaleString('ja-JP')} 円を含む。` : '';
  if (input.observedDays < 7 && input.scheduledYen <= 0) {
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
  const pace = input.paceYen > 0 ? input.paceYen : 0;
  const base = input.spentYen + input.scheduledYen;
  const medianYen = round100(base + pace * days);
  const lowYen = round100(base + pace * 0.6 * days);
  const highYen = round100(base + pace * 1.6 * days);
  const cap = days > 0 && input.targetYen > base ? round100((input.targetYen - base) / days) : null;
  const dailyCapYen = cap !== null && pace > 0 && cap >= pace / 2 ? cap : null;

  if (input.scheduledYen > 0 && input.scheduledYen + input.spentYen >= input.targetYen) {
    return {
      medianYen,
      lowYen,
      highYen,
      verdict: 'unreachable',
      label: `届かない。使った額と予定だけで目標を超える。${scheduledNote}`,
      dailyCapYen: null,
    };
  }
  if (medianYen <= input.targetYen && highYen <= input.targetYen) {
    return {
      medianYen,
      lowYen,
      highYen,
      verdict: 'on_track',
      label: `このままで届きそう。${scheduledNote}`,
      dailyCapYen,
    };
  }
  if (medianYen <= input.targetYen) {
    return {
      medianYen,
      lowYen,
      highYen,
      verdict: 'tight',
      label: `中央では届く。上振れすると超える。${scheduledNote}`,
      dailyCapYen,
    };
  }
  return {
    medianYen,
    lowYen,
    highYen,
    verdict: 'over',
    label: `このままだと ${medianYen.toLocaleString('ja-JP')} 円ぐらいで着く。${scheduledNote}`,
    dailyCapYen,
  };
}

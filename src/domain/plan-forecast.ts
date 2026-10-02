export type ForecastVerdict = 'unknown' | 'unreachable' | 'on_track' | 'tight' | 'over';

export type GenreForecast = {
  medianYen: number | null;
  lowYen: number | null;
  highYen: number | null;
  /** 70%で収まる着地。目標に写す額。 */
  recommendedYen: number | null;
  /** 今の目標を超える試行の割合。 */
  exceedance: number | null;
  verdict: ForecastVerdict;
  label: string;
  dailyCapYen: number | null;
};

export type GenreForecastInput = {
  spentYen: number;
  scheduledYen: number;
  meanDailyYen: number;
  medianDailyYen: number;
  observedDays: number;
  targetYen: number;
};

const TRIALS = 2000;
const AMOUNT_SIGMA = 0.7;

function round100(yen: number): number {
  return Math.max(0, Math.round(yen / 100) * 100);
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (index - lo);
}

function occurrence(medianDailyYen: number, meanDailyYen: number): number {
  if (medianDailyYen <= 0 && meanDailyYen <= 0) return 0;
  return medianDailyYen > 0 ? 0.62 : 0.28;
}

type DayModel = {
  known: boolean;
  committed: number;
  p: number;
  mu: number;
};

function dayModel(input: GenreForecastInput): DayModel {
  const committed = input.spentYen + input.scheduledYen;
  const known = input.observedDays >= 7 || input.scheduledYen > 0;
  const mean = input.meanDailyYen > 0 ? input.meanDailyYen : input.medianDailyYen;
  const p = occurrence(input.medianDailyYen, mean);
  const positiveMean = p > 0 && mean > 0 ? mean / p : 0;
  const mu = positiveMean > 0 ? Math.log(positiveMean) - AMOUNT_SIGMA ** 2 / 2 : 0;
  return { known, committed, p, mu };
}

function labelFor(input: {
  verdict: ForecastVerdict;
  exceedance: number | null;
  recommendedYen: number | null;
  scheduledYen: number;
}): string {
  const scheduled =
    input.scheduledYen > 0 ? `予定 ${input.scheduledYen.toLocaleString('ja-JP')} 円を含む。` : '';
  if (input.verdict === 'unknown') return 'まだ判断できない。このジャンルの支出が少ない。';
  if (input.verdict === 'unreachable') {
    return `届かない。使った額と予定だけで目標を超える。${scheduled}`;
  }
  const pct =
    input.exceedance === null ? '' : `超える確率は${Math.round(input.exceedance * 100)}%。`;
  const rec =
    input.recommendedYen === null
      ? ''
      : `70%で収まる額は ${input.recommendedYen.toLocaleString('ja-JP')} 円。`;
  if (input.verdict === 'on_track') return `このままで届きそう。${rec}${pct}${scheduled}`;
  if (input.verdict === 'tight')
    return `中央では届く。上振れすると超える。${rec}${pct}${scheduled}`;
  return `このままだと目標を超える。${rec}${pct}${scheduled}`;
}

/** カテゴリを同じ日のショックで一緒に引き、着地分布を作る。 */
export function forecastPlan(input: {
  genres: readonly GenreForecastInput[];
  remainingDays: number;
  seed: string;
  trials?: number;
}): { genres: GenreForecast[]; totalMedianYen: number | null; totalRecommendedYen: number | null } {
  const trials = input.trials ?? TRIALS;
  const days = Math.max(input.remainingDays, 0);
  const models = input.genres.map(dayModel);
  const rng = mulberry32(hashSeed(input.seed));
  const samples = input.genres.map(() => [] as number[]);
  const totals: number[] = [];

  for (let trial = 0; trial < trials; trial++) {
    const variable = input.genres.map(() => 0);
    for (let day = 0; day < days; day++) {
      const shared = normal(rng) * 0.35;
      for (let i = 0; i < models.length; i++) {
        const model = models[i]!;
        if (!model.known || model.p <= 0 || model.mu === 0) continue;
        if (rng() > model.p) continue;
        const amount = Math.exp(model.mu + shared + normal(rng) * 0.55);
        variable[i] = (variable[i] ?? 0) + amount;
      }
    }
    let total = 0;
    for (let i = 0; i < models.length; i++) {
      const landing = models[i]!.committed + (variable[i] ?? 0);
      samples[i]!.push(landing);
      total += landing;
    }
    totals.push(total);
  }

  const genres = input.genres.map((genre, i) => {
    const model = models[i]!;
    if (!model.known) {
      return {
        medianYen: null,
        lowYen: null,
        highYen: null,
        recommendedYen: null,
        exceedance: null,
        verdict: 'unknown' as const,
        label: labelFor({
          verdict: 'unknown',
          exceedance: null,
          recommendedYen: null,
          scheduledYen: genre.scheduledYen,
        }),
        dailyCapYen: null,
      };
    }
    const sorted = [...samples[i]!].sort((a, b) => a - b);
    const medianYen = round100(quantile(sorted, 0.5));
    const lowYen = round100(quantile(sorted, 0.1));
    const highYen = round100(quantile(sorted, 0.9));
    const recommendedYen = round100(quantile(sorted, 0.7));
    const exceedance = sorted.filter((yen) => yen > genre.targetYen).length / sorted.length;
    const verdict: ForecastVerdict =
      model.committed >= genre.targetYen
        ? 'unreachable'
        : exceedance <= 0.2
          ? 'on_track'
          : exceedance <= 0.5
            ? 'tight'
            : 'over';
    const cap =
      days > 0 && genre.targetYen > model.committed
        ? round100((genre.targetYen - model.committed) / days)
        : null;
    return {
      medianYen,
      lowYen,
      highYen,
      recommendedYen,
      exceedance,
      verdict,
      label: labelFor({
        verdict,
        exceedance,
        recommendedYen,
        scheduledYen: genre.scheduledYen,
      }),
      dailyCapYen: cap,
    };
  });

  const known = genres.some((genre) => genre.recommendedYen !== null);
  const sortedTotals = [...totals].sort((a, b) => a - b);
  return {
    genres,
    totalMedianYen: known ? round100(quantile(sortedTotals, 0.5)) : null,
    totalRecommendedYen: known ? round100(quantile(sortedTotals, 0.7)) : null,
  };
}

export type SavingsAsk = {
  /** 今の着地から目標まで削る額。届くときは 0。 */
  saveYen: number;
  /** 残り日数で抑えてほしい1日の額。届かないときは 0。 */
  keepDailyYen: number | null;
  text: string;
};

/** 予想ではなく、抑えてほしい額。着地が目標を超えるときだけ節約を出す。 */
export function savingsAsk(input: {
  verdict: ForecastVerdict;
  targetYen: number;
  medianYen: number | null;
  remainingDays: number;
  dailyCapYen: number | null;
}): SavingsAsk {
  const yen = (n: number) => n.toLocaleString('ja-JP');
  if (input.verdict === 'unknown' || input.medianYen === null) {
    return { saveYen: 0, keepDailyYen: null, text: 'まだ判断できない。支出のあった日が少ない。' };
  }
  if (input.verdict === 'unreachable') {
    return {
      saveYen: Math.max(0, input.medianYen - input.targetYen),
      keepDailyYen: 0,
      text: `使った額と予定だけで目標を超えている。今日からの自由な支出は 0 円に抑えてほしい。`,
    };
  }
  const saveYen = Math.max(0, input.medianYen - input.targetYen);
  if (saveYen === 0) {
    return {
      saveYen: 0,
      keepDailyYen: input.dailyCapYen,
      text: `このままで目標に届く。抑える額はない。`,
    };
  }
  const daily =
    input.dailyCapYen === null
      ? ''
      : `残り ${input.remainingDays} 日は 1 日 ${yen(input.dailyCapYen)} 円に抑えてほしい。`;
  return {
    saveYen,
    keepDailyYen: input.dailyCapYen,
    text: `着地は ${yen(input.medianYen)} 円。${yen(saveYen)} 円節約して ${yen(input.targetYen)} 円に抑えてほしい。${daily}`,
  };
}

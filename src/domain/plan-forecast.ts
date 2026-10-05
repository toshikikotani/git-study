/**
 * 目標のジャンルごとの判定と、抑えてほしい額(AIは使わない)。
 * 着地の分布は確率エンジン(domain/forecast/engine.ts)の1本だけから出し、ここでは
 * その結果を「届きそうか」の言葉と額に直す。予測の式をこのファイルに持たない。
 */

import { formatProbability } from '@/domain/forecast/format';
import type { Forecast } from '@/domain/forecast/types';

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

/** 支出のあった日がこれ未満で、予定も無いジャンルは、着地を置かない(判断できない)。 */
const MIN_DATA_DAYS = 7;

function round100(yen: number): number {
  return Math.max(0, Math.round(yen / 100) * 100);
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
    input.exceedance === null ? '' : `超える確率は${formatProbability(input.exceedance)}。`;
  const rec =
    input.recommendedYen === null
      ? ''
      : `70%で収まる額は ${input.recommendedYen.toLocaleString('ja-JP')} 円。`;
  if (input.verdict === 'on_track') return `このままで届きそう。${rec}${pct}${scheduled}`;
  if (input.verdict === 'tight')
    return `中央では届く。上振れすると超える。${rec}${pct}${scheduled}`;
  return `このままだと目標を超える。${rec}${pct}${scheduled}`;
}

/**
 * 確率エンジンの結果から、目標のあるジャンルごとの判定を作る。
 * forecast は categoryTargets を渡して作ったもの(ジャンルごとの超過確率を持つ)。
 */
export function genreForecastsFrom(input: {
  forecast: Forecast;
  genres: readonly { genreId: string; targetYen: number; scheduledYen: number }[];
  remainingDays: number;
}): GenreForecast[] {
  const byId = new Map(input.forecast.byCategory.map((c) => [c.categoryId, c]));
  const days = Math.max(input.remainingDays, 0);
  return input.genres.map((genre): GenreForecast => {
    const cat = byId.get(genre.genreId);
    const known = input.forecast.dataDays >= MIN_DATA_DAYS || genre.scheduledYen > 0;
    if (cat === undefined || !known) {
      return {
        medianYen: null,
        lowYen: null,
        highYen: null,
        recommendedYen: null,
        exceedance: null,
        verdict: 'unknown',
        label: labelFor({
          verdict: 'unknown',
          exceedance: null,
          recommendedYen: null,
          scheduledYen: genre.scheduledYen,
        }),
        dailyCapYen: null,
      };
    }
    const exceedance = cat.exceedance ?? 0;
    const verdict: ForecastVerdict =
      cat.baseYen >= genre.targetYen
        ? 'unreachable'
        : exceedance <= 0.2
          ? 'on_track'
          : exceedance <= 0.5
            ? 'tight'
            : 'over';
    const recommendedYen = round100(cat.landing.p70);
    return {
      medianYen: round100(cat.landing.p50),
      lowYen: round100(cat.landing.p10),
      highYen: round100(cat.landing.p90),
      recommendedYen,
      exceedance,
      verdict,
      label: labelFor({ verdict, exceedance, recommendedYen, scheduledYen: genre.scheduledYen }),
      dailyCapYen:
        days > 0 && genre.targetYen > cat.baseYen
          ? round100((genre.targetYen - cat.baseYen) / days)
          : null,
    };
  });
}

export type SavingsAsk = {
  /** 着地より下に抑える額。予算に届かせないための差。 */
  saveYen: number;
  /** 残り日数で抑えてほしい1日の額。 */
  keepDailyYen: number | null;
  /** 着地より下の、抑えてほしい期間額。 */
  keepUnderYen: number | null;
  text: string;
};

/** 予算は届ける目標ではない。着地より下に抑えた差が貯蓄になる。 */
export function savingsAsk(input: {
  verdict: ForecastVerdict;
  targetYen: number;
  medianYen: number | null;
  lowYen: number | null;
  committedYen: number;
  remainingDays: number;
}): SavingsAsk {
  const yen = (n: number) => n.toLocaleString('ja-JP');
  if (input.verdict === 'unknown' || input.medianYen === null) {
    return {
      saveYen: 0,
      keepDailyYen: null,
      keepUnderYen: null,
      text: 'まだ判断できない。支出のあった日が少ない。',
    };
  }
  if (input.verdict === 'unreachable') {
    return {
      saveYen: Math.max(0, input.medianYen - input.targetYen),
      keepDailyYen: 0,
      keepUnderYen: input.committedYen,
      text: '使った額と予定だけで上限を超えている。今日からの自由な支出は 0 円に抑えてほしい。',
    };
  }
  const floor =
    input.lowYen !== null && input.lowYen < input.medianYen
      ? input.lowYen
      : round100(input.medianYen * 0.8);
  const keepUnderYen = Math.max(input.committedYen, Math.min(floor, input.medianYen));
  const saveYen = Math.max(0, input.medianYen - keepUnderYen);
  const room = Math.max(0, keepUnderYen - input.committedYen);
  const keepDailyYen = input.remainingDays > 0 ? round100(room / input.remainingDays) : 0;
  return {
    saveYen,
    keepDailyYen,
    keepUnderYen,
    text: `着地は ${yen(input.medianYen)} 円。予算は上限で、届かせない方が貯蓄になる。${yen(saveYen)} 円抑えて ${yen(keepUnderYen)} 円にしてほしい。残り ${input.remainingDays} 日は 1 日 ${yen(keepDailyYen)} 円。`,
  };
}

export type TwoMonthTendency = {
  text: string;
  /** 低い方の月に抑えたとき、今の着地より残る額。 */
  savedYen: number | null;
};

/** 過去2ヶ月の傾向と、低い方に抑えたときの差。両方0円なら出さない。 */
export function twoMonthTendency(input: {
  priorYen: number;
  previousYen: number;
  landingYen: number | null;
}): TwoMonthTendency {
  const yen = (n: number) => n.toLocaleString('ja-JP');
  if (input.priorYen <= 0 && input.previousYen <= 0) return { text: '', savedYen: null };
  if (input.priorYen <= 0 || input.previousYen <= 0) {
    const known = Math.max(input.priorYen, input.previousYen);
    return {
      text: `2ヶ月そろっていない。記録がある月は ${known.toLocaleString('ja-JP')} 円。`,
      savedYen: null,
    };
  }
  const lower = Math.min(input.priorYen, input.previousYen);
  const rising = input.previousYen > input.priorYen * 1.15 && input.priorYen > 0;
  const falling = input.priorYen > input.previousYen * 1.15 && input.previousYen > 0;
  const direction = rising ? '増えている。' : falling ? '減っている。' : 'ほぼ同じ水準。';
  const saved =
    input.landingYen !== null && input.landingYen > lower ? input.landingYen - lower : null;
  const outcome =
    saved === null
      ? `低い方の ${yen(lower)} 円に抑えると、その額が今月の上限になる。`
      : `低い方の ${yen(lower)} 円に抑えると、今の着地より ${yen(saved)} 円残る。`;
  return {
    savedYen: saved,
    text: `先々月 ${yen(input.priorYen)} 円、先月 ${yen(input.previousYen)} 円。${direction}${outcome}`,
  };
}

export type GenreLanding = {
  genreId: string;
  genreName: string;
  spentYen: number;
  scheduledYen: number;
  medianYen: number | null;
  lowYen: number | null;
  highYen: number | null;
  /** 抑えてほしい額(目標案にする額)。判断できなければ null。 */
  recommendedYen: number | null;
  exceedance: number | null;
  label: string;
  advice: string;
  detail: string;
};

export type LandingReport = {
  summary: string;
  proposedTotalYen: number | null;
  forecasts: GenreLanding[];
};

/**
 * 着地の予測(forecastPlan)を、ジャンルごとの説明と「抑えてほしい額」にまとめる。
 * rows と forecasts は同じ順(forecastPlan に rows の入力を同じ順で渡した結果)。
 */
export function landingReport(input: {
  remainingDays: number;
  rows: readonly {
    genreId: string;
    genreName: string;
    targetYen: number;
    spentYen: number;
    scheduledYen: number;
    priorMonthYen: number;
    previousMonthYen: number;
  }[];
  forecasts: readonly GenreForecast[];
}): LandingReport {
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const { remainingDays } = input;
  const forecasts = input.rows.map((row, index): GenreLanding => {
    const forecast = input.forecasts[index]!;
    const probability =
      forecast.exceedance === null
        ? ''
        : `今の目標を超える確率は ${formatProbability(forecast.exceedance)}。`;
    const detail = [
      `この期間にすでに ${yen(row.spentYen)} 円使っている。`,
      row.scheduledYen > 0
        ? `これから日付の入っている予定が ${yen(row.scheduledYen)} 円ある。`
        : '日付の入っている予定は無い。',
      forecast.medianYen === null
        ? '支出のあった日が少なく、残りの着地はまだ置けない。'
        : `残りの ${remainingDays} 日を確率で試すと、中央は ${yen(forecast.medianYen)} 円、下振れ〜上振れ(10回中8回)は ${yen(forecast.lowYen ?? forecast.medianYen)}〜${yen(forecast.highYen ?? forecast.medianYen)} 円。70%で収まる額は ${yen(forecast.recommendedYen ?? forecast.medianYen)} 円。${probability}`,
    ].join('');
    const ask = savingsAsk({
      verdict: forecast.verdict,
      targetYen: row.targetYen,
      medianYen: forecast.medianYen,
      lowYen: forecast.lowYen,
      committedYen: row.spentYen + row.scheduledYen,
      remainingDays,
    });
    return {
      genreId: row.genreId,
      genreName: row.genreName,
      spentYen: row.spentYen,
      scheduledYen: row.scheduledYen,
      medianYen: forecast.medianYen,
      lowYen: forecast.lowYen,
      highYen: forecast.highYen,
      recommendedYen: ask.keepUnderYen,
      exceedance: forecast.exceedance,
      label: forecast.label,
      advice: [
        ask.text,
        twoMonthTendency({
          priorYen: row.priorMonthYen,
          previousYen: row.previousMonthYen,
          landingYen: forecast.medianYen,
        }).text,
      ]
        .filter(Boolean)
        .join(''),
      detail,
    };
  });
  const known = forecasts.filter((row) => row.recommendedYen !== null);
  const proposed = known.reduce((sum, row) => sum + (row.recommendedYen ?? 0), 0);
  return {
    summary:
      known.length === 0
        ? 'まだ判断できるジャンルがありません。支出のあった日が少ないものは、予定があるときだけ着地に入れています。'
        : `抑えてほしい額の合計は ${yen(proposed)} 円。着地ではなく、この額を目標案にする。`,
    proposedTotalYen: known.length === 0 ? null : proposed,
    forecasts,
  };
}

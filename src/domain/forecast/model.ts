/**
 * M2:変動費のベイズ階層モデル。カテゴリ×日ごとに「回数」(ポアソン、ガンマ事前分布
 * との共役更新)と「1回の金額」(対数正規、全カテゴリの平均へ縮小推定)を別々に
 * 推定する。曜日・給料日直後・祝日の係数も1.0(効果なし)へ縮小推定する。
 *
 * 直近を重く扱う:観測の重みを 0.5^(経過日数 ÷ 30) にする(半減期30日、本人発案の
 * 仕様どおり)。
 */

import { addMonths, daysBetween, nthDayOfMonth, weekdayOf, type DateOnly } from '@/lib/date';
import { isFixedHoliday } from './holidays';
import type { CategoryModelParams, DayBundle, FittedModel, VariableTrainingData } from './types';

const RECENCY_HALF_LIFE_DAYS = 30;
/** 回数の事前分布の強さ(本人発案「7日分の観測に相当する程度」)。 */
const COUNT_PRIOR_DAYS = 7;
/** 曜日・給料日・祝日係数の事前分布の強さ(日換算)。強いほど1.0に寄る。 */
const COEF_PRIOR_DAYS = 30;
/** 金額分布(対数正規)の事前分布の強さ(観測件数換算)。 */
const AMOUNT_PRIOR_STRENGTH = 10;
const PAYDAY_WINDOW_DAYS = 3;
const MIN_SAMPLES_FOR_OWN_VARIANCE = 5;
const FALLBACK_LOG_SIGMA_SQ = 0.7 ** 2;

/**
 * 記録が一切無いとき(dataDays=0)だけ使う、最後のフォールバック値。
 * 本人発案の指示にある総務省「家計調査」単身世帯データの厳密な参照は
 * このセッションの手段では入手できないため、代わりに「1日あたり0.1回、
 * 1回1,500円程度」という控えめな概算値を暫定的に置いた
 * (docs/decisions.md に記録。実データが1件でも入ればこの値は使われない)。
 */
const FALLBACK_DAILY_RATE = 0.1;
const FALLBACK_LOG_MEAN = Math.log(1500);

function recencyWeight(date: DateOnly, today: DateOnly): number {
  const ago = Math.max(0, daysBetween(date, today));
  return Math.pow(0.5, ago / RECENCY_HALF_LIFE_DAYS);
}

export function isPaydayWindow(date: DateOnly, payday: number): boolean {
  const thisMonthPayday = nthDayOfMonth(date, payday);
  const candidates = [thisMonthPayday, nthDayOfMonth(addMonths(date, -1), payday)];
  return candidates.some((p) => {
    const diff = daysBetween(p, date);
    return diff >= 0 && diff < PAYDAY_WINDOW_DAYS;
  });
}

type WeightedSum = { countWeighted: number; dayWeight: number };

function shrinkToOne(sub: WeightedSum, overallRate: number): number {
  if (sub.dayWeight <= 0) return 1;
  const subRate = sub.countWeighted / sub.dayWeight;
  const raw = overallRate > 0 ? subRate / overallRate : 1;
  const shrink = sub.dayWeight / (sub.dayWeight + COEF_PRIOR_DAYS);
  return 1 + shrink * (raw - 1);
}

function fitCategory(
  cat: VariableTrainingData,
  weightByDate: ReadonlyMap<DateOnly, number>,
  pooledDailyRate: number,
  pooledLogMean: number,
  payday: number | null,
): CategoryModelParams {
  let weightedCount = 0;
  let weight = 0;
  let logSum = 0;
  let logSqSum = 0;
  let logWeight = 0;
  const weekdaySums: WeightedSum[] = Array.from({ length: 7 }, () => ({
    countWeighted: 0,
    dayWeight: 0,
  }));
  const paydaySums: WeightedSum = { countWeighted: 0, dayWeight: 0 };
  const holidaySums: WeightedSum = { countWeighted: 0, dayWeight: 0 };

  for (const rec of cat.days) {
    const w = weightByDate.get(rec.date) ?? 0;
    weightedCount += w * rec.count;
    weight += w;

    const wd = weekdayOf(rec.date);
    weekdaySums[wd]!.countWeighted += w * rec.count;
    weekdaySums[wd]!.dayWeight += w;

    if (payday !== null && isPaydayWindow(rec.date, payday)) {
      paydaySums.countWeighted += w * rec.count;
      paydaySums.dayWeight += w;
    }
    if (isFixedHoliday(rec.date)) {
      holidaySums.countWeighted += w * rec.count;
      holidaySums.dayWeight += w;
    }

    if (rec.count > 0) {
      const avgAmount = rec.amountYen / rec.count;
      const logAmt = Math.log(Math.max(1, avgAmount));
      logSum += w * rec.count * logAmt;
      logSqSum += w * rec.count * logAmt * logAmt;
      logWeight += w * rec.count;
    }
  }

  const priorAlpha = pooledDailyRate * COUNT_PRIOR_DAYS;
  const priorBeta = COUNT_PRIOR_DAYS;
  const countPosterior = { alpha: priorAlpha + weightedCount, beta: priorBeta + weight };

  const rawMu = logWeight > 0 ? logSum / logWeight : pooledLogMean;
  const amountShrink = logWeight / (logWeight + AMOUNT_PRIOR_STRENGTH);
  const mu = pooledLogMean + amountShrink * (rawMu - pooledLogMean);
  const sigmaSq =
    logWeight >= MIN_SAMPLES_FOR_OWN_VARIANCE
      ? Math.max(0.05, logSqSum / logWeight - rawMu * rawMu)
      : FALLBACK_LOG_SIGMA_SQ;

  const overallRate = weight > 0 ? weightedCount / weight : pooledDailyRate;

  return {
    categoryId: cat.categoryId,
    categoryName: cat.categoryName,
    countPosterior,
    amountPosterior: { mu, sigmaSq, kappa: logWeight + AMOUNT_PRIOR_STRENGTH },
    weekdayFactor: weekdaySums.map((s) => shrinkToOne(s, overallRate)),
    paydayFactor: shrinkToOne(paydaySums, overallRate),
    holidayFactor: shrinkToOne(holidaySums, overallRate),
    dataDays: cat.days.length,
  };
}

export function fitModel(input: {
  variable: readonly VariableTrainingData[];
  today: DateOnly;
  /** 給料日(1〜31)。無ければ給料日係数は常に1.0。 */
  payday: number | null;
}): FittedModel {
  const { variable, today, payday } = input;
  const dates = variable[0]?.days.map((d) => d.date) ?? [];
  const weightByDate = new Map(dates.map((d) => [d, recencyWeight(d, today)]));

  let pooledWeightedCount = 0;
  let pooledWeight = 0;
  let pooledLogSum = 0;
  let pooledLogWeight = 0;
  for (const cat of variable) {
    for (const rec of cat.days) {
      const w = weightByDate.get(rec.date) ?? 0;
      pooledWeightedCount += w * rec.count;
      pooledWeight += w;
      if (rec.count > 0) {
        const avgAmount = rec.amountYen / rec.count;
        const logAmt = Math.log(Math.max(1, avgAmount));
        pooledLogSum += w * rec.count * logAmt;
        pooledLogWeight += w * rec.count;
      }
    }
  }
  const pooledDailyRate =
    pooledWeight > 0 ? pooledWeightedCount / pooledWeight : FALLBACK_DAILY_RATE;
  const pooledLogMean = pooledLogWeight > 0 ? pooledLogSum / pooledLogWeight : FALLBACK_LOG_MEAN;

  const categories = variable.map((cat) =>
    fitCategory(cat, weightByDate, pooledDailyRate, pooledLogMean, payday),
  );

  const recordsByCategory = new Map(
    variable.map((cat) => [cat.categoryId, new Map(cat.days.map((d) => [d.date, d.amountYen]))]),
  );
  const dayBundles: DayBundle[] = dates.map((date) => {
    const amountsByCategory = new Map<string, number>();
    for (const cat of variable) {
      amountsByCategory.set(cat.categoryId, recordsByCategory.get(cat.categoryId)?.get(date) ?? 0);
    }
    return { date, weight: weightByDate.get(date) ?? 0, amountsByCategory };
  });

  return { categories, dayBundles, pooledDailyRate, dataDays: dates.length };
}

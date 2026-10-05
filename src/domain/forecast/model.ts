/**
 * M2:変動費のベイズ階層モデル。カテゴリ×日ごとに「回数」(ポアソン、ガンマ事前分布
 * との共役更新)と「1回の金額」(対数正規、全カテゴリの平均へ縮小推定)を別々に
 * 推定する。曜日・給料日直後・祝日の係数も1.0(効果なし)へ縮小推定する。
 *
 * 直近を重く扱う:観測の重みを 0.5^(経過日数 ÷ 半減期) にする。半減期は当初30日(本人発案の仕様)
 * だったが、短いと回数の少ないカテゴリの率がぶれて系統的に低く出た(ADR-068)。既定は90日にし、
 * 本人の過去の月での検証で 30・90・180日から選ぶ。
 */

import {
  addMonths,
  daysBetween,
  nthDayOfMonth,
  splitDateOnly,
  weekdayOf,
  type DateOnly,
} from '@/lib/date';
import { isDayOff, isHoliday } from './holidays';
import type { CategoryModelParams, DayBundle, FittedModel, VariableTrainingData } from './types';

/** 季節の係数を出すのに必要な、記録のそろった月の数。 */
const MIN_MONTHS_FOR_SEASON = 12;
const SEASON_CLAMP = { min: 0.6, max: 1.6 } as const;
const NO_SEASON: readonly number[] = Array.from({ length: 13 }, () => 1);

/** 直近を重く見る重みの半減期(日)の既定値。検証で、本人の記録に合う値を選ぶ(RECENCY_HALF_LIFE_CANDIDATES)。 */
export const DEFAULT_HALF_LIFE_DAYS = 90;
export const RECENCY_HALF_LIFE_CANDIDATES = [30, 90, 180] as const;
/** 回数の事前分布の強さ(本人発案「7日分の観測に相当する程度」)。 */
const COUNT_PRIOR_DAYS = 7;
/** 曜日・給料日・祝日係数の事前分布の強さ(日換算)。強いほど1.0に寄る。 */
const COEF_PRIOR_DAYS = 30;
/**
 * 金額分布(対数正規)の事前分布の強さ(観測件数換算)。カテゴリごとに金額の大きさが大きく違う
 * (趣味と飲み物など)ので、全カテゴリの平均へ強く引き寄せると高額なカテゴリが系統的に低く出る。
 * 10だった強さを1にした(ADR-069)。
 */
const AMOUNT_PRIOR_STRENGTH = 1;
/** 休みの日と平日で1回の金額が違うか、を信じる強さ(少ない方の観測件数換算)。 */
const DAY_OFF_AMOUNT_PRIOR = 6;
const DAY_OFF_DELTA_CLAMP = 1.2;
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

function recencyWeight(date: DateOnly, today: DateOnly, halfLifeDays: number): number {
  const ago = Math.max(0, daysBetween(date, today));
  return Math.pow(0.5, ago / halfLifeDays);
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

/**
 * 月ごとの季節の係数(添字1〜12)。記録のそろった月(月初から月末まで学習窓に入っている月)が
 * 12か月以上あるときだけ出す。月ごとの1日あたりの支出を、全体の平均で割った比を、
 * 観測した年の数が少ないほど1.0へ寄せる(1年分だけなら半分、2年分なら3分の2だけ信じる)。
 */
export function seasonalFactors(
  variable: readonly VariableTrainingData[],
  today: DateOnly,
): { factors: readonly number[]; active: boolean } {
  const dates = variable[0]?.days.map((d) => d.date) ?? [];
  if (dates.length === 0) return { factors: NO_SEASON, active: false };
  const first = dates[0]!;
  const last = dates[dates.length - 1]! < today ? dates[dates.length - 1]! : today;

  const dailyTotal = new Map<DateOnly, number>();
  for (const cat of variable) {
    for (const rec of cat.days) {
      dailyTotal.set(rec.date, (dailyTotal.get(rec.date) ?? 0) + rec.amountYen);
    }
  }
  const monthSum = new Map<string, { sum: number; days: number }>();
  for (const date of dates) {
    if (date > last) continue;
    const key = date.slice(0, 7);
    const acc = monthSum.get(key) ?? { sum: 0, days: 0 };
    acc.sum += dailyTotal.get(date) ?? 0;
    acc.days += 1;
    monthSum.set(key, acc);
  }
  const instances: { month: number; mean: number }[] = [];
  for (const [key, acc] of monthSum) {
    const monthStart = `${key}-01`;
    const nextMonthStart = addMonths(monthStart, 1);
    const daysInMonth = daysBetween(monthStart, nextMonthStart);
    const complete = acc.days === daysInMonth && monthStart >= first && acc.days > 0;
    if (complete) instances.push({ month: splitDateOnly(monthStart)[1], mean: acc.sum / acc.days });
  }
  if (instances.length < MIN_MONTHS_FOR_SEASON) return { factors: NO_SEASON, active: false };
  const overall = instances.reduce((a, b) => a + b.mean, 0) / instances.length;
  if (overall <= 0) return { factors: NO_SEASON, active: false };

  const factors = [1, ...Array.from({ length: 12 }, () => 1)];
  for (let month = 1; month <= 12; month += 1) {
    const own = instances.filter((i) => i.month === month);
    if (own.length === 0) continue;
    const raw = own.reduce((a, b) => a + b.mean, 0) / own.length / overall;
    const weight = own.length / (own.length + 1);
    factors[month] = Math.min(SEASON_CLAMP.max, Math.max(SEASON_CLAMP.min, 1 + weight * (raw - 1)));
  }
  return { factors, active: true };
}

/**
 * 残り期間の各日の回数の係数(曜日・給料日・祝日・月の季節)を足した値。
 * 回数の率 λ に掛けると、その期間の期待回数になる。試行によらないので、試行の外で1回だけ呼ぶ。
 */
export function rateFactorSum(
  cat: Pick<CategoryModelParams, 'weekdayFactor' | 'paydayFactor' | 'holidayFactor'>,
  dates: readonly DateOnly[],
  payday: number | null,
  monthFactor: readonly number[] = NO_SEASON,
): number {
  const { dayOff, weekday } = rateFactorSplit(cat, dates, payday, monthFactor);
  return dayOff + weekday;
}

/** rateFactorSum を、休みの日(土日祝)と平日に分けた値。休みの日は1回の金額が違う(dayOffAmount)ため。 */
export function rateFactorSplit(
  cat: Pick<CategoryModelParams, 'weekdayFactor' | 'paydayFactor' | 'holidayFactor'>,
  dates: readonly DateOnly[],
  payday: number | null,
  monthFactor: readonly number[] = NO_SEASON,
): { dayOff: number; weekday: number } {
  let dayOff = 0;
  let weekday = 0;
  for (const date of dates) {
    let factor = cat.weekdayFactor[weekdayOf(date)] ?? 1;
    if (payday !== null && isPaydayWindow(date, payday)) factor *= cat.paydayFactor;
    if (isHoliday(date)) factor *= cat.holidayFactor;
    factor *= monthFactor[splitDateOnly(date)[1]] ?? 1;
    if (isDayOff(date)) dayOff += Math.max(0, factor);
    else weekday += Math.max(0, factor);
  }
  return { dayOff, weekday };
}

function fitCategory(
  cat: VariableTrainingData,
  weightByDate: ReadonlyMap<DateOnly, number>,
  pooledDailyRate: number,
  pooledLogMean: number,
  payday: number | null,
  monthFactor: readonly number[],
): CategoryModelParams {
  let weightedCount = 0;
  let weight = 0;
  let logSum = 0;
  let logSqSum = 0;
  let logWeight = 0;
  const off = { logSum: 0, weight: 0 };
  const on = { logSum: 0, weight: 0 };
  const weekdaySums: WeightedSum[] = Array.from({ length: 7 }, () => ({
    countWeighted: 0,
    dayWeight: 0,
  }));
  const paydaySums: WeightedSum = { countWeighted: 0, dayWeight: 0 };
  const holidaySums: WeightedSum = { countWeighted: 0, dayWeight: 0 };

  for (const rec of cat.days) {
    const w = weightByDate.get(rec.date) ?? 0;
    // 季節の係数がある月は、その分を取り除いた回数で学習する(夏に多い分を平常の率に混ぜない)。
    const count = rec.count / (monthFactor[splitDateOnly(rec.date)[1]] || 1);
    weightedCount += w * count;
    weight += w;

    const wd = weekdayOf(rec.date);
    weekdaySums[wd]!.countWeighted += w * count;
    weekdaySums[wd]!.dayWeight += w;

    if (payday !== null && isPaydayWindow(rec.date, payday)) {
      paydaySums.countWeighted += w * count;
      paydaySums.dayWeight += w;
    }
    if (isHoliday(rec.date)) {
      holidaySums.countWeighted += w * count;
      holidaySums.dayWeight += w;
    }

    if (rec.count > 0) {
      const avgAmount = rec.amountYen / rec.count;
      const logAmt = Math.log(Math.max(1, avgAmount));
      logSum += w * rec.count * logAmt;
      logSqSum += w * rec.count * logAmt * logAmt;
      logWeight += w * rec.count;
      const bucket = isDayOff(rec.date) ? off : on;
      bucket.logSum += w * rec.count * logAmt;
      bucket.weight += w * rec.count;
    }
  }

  const priorAlpha = pooledDailyRate * COUNT_PRIOR_DAYS;
  const priorBeta = COUNT_PRIOR_DAYS;
  const countPosterior = { alpha: priorAlpha + weightedCount, beta: priorBeta + weight };

  const rawMu = logWeight > 0 ? logSum / logWeight : pooledLogMean;
  const amountShrink = logWeight / (logWeight + AMOUNT_PRIOR_STRENGTH);
  const mu = pooledLogMean + amountShrink * (rawMu - pooledLogMean);
  // 休みの日(土日祝)と平日で、1回の金額が違うか。違いは観測が少ないほど0へ寄せる。
  const smaller = Math.min(off.weight, on.weight);
  const delta =
    off.weight > 0 && on.weight > 0
      ? Math.max(
          -DAY_OFF_DELTA_CLAMP,
          Math.min(
            DAY_OFF_DELTA_CLAMP,
            (smaller / (smaller + DAY_OFF_AMOUNT_PRIOR)) *
              (off.logSum / off.weight - on.logSum / on.weight),
          ),
        )
      : 0;
  const offShare = off.weight + on.weight > 0 ? off.weight / (off.weight + on.weight) : 0;
  // 休みか平日かで説明できるばらつきは、金額のばらつき(σ²)から除く。
  const totalSigmaSq =
    logWeight >= MIN_SAMPLES_FOR_OWN_VARIANCE
      ? Math.max(0.05, logSqSum / logWeight - rawMu * rawMu)
      : FALLBACK_LOG_SIGMA_SQ;
  const sigmaSq = Math.max(0.05, totalSigmaSq - offShare * (1 - offShare) * delta * delta);

  const overallRate = weight > 0 ? weightedCount / weight : pooledDailyRate;

  return {
    categoryId: cat.categoryId,
    categoryName: cat.categoryName,
    countPosterior,
    amountPosterior: { mu, sigmaSq, kappa: logWeight + AMOUNT_PRIOR_STRENGTH },
    dayOffAmount: { delta, share: offShare },
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
  /** 直近を重く見る重みの半減期(日)。 */
  halfLifeDays?: number;
}): FittedModel {
  const { variable, today, payday } = input;
  const halfLife = input.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const dates = variable[0]?.days.map((d) => d.date) ?? [];
  const weightByDate = new Map(dates.map((d) => [d, recencyWeight(d, today, halfLife)]));

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

  const season = seasonalFactors(variable, today);
  const categories = variable.map((cat) =>
    fitCategory(cat, weightByDate, pooledDailyRate, pooledLogMean, payday, season.factors),
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

  return {
    categories,
    dayBundles,
    pooledDailyRate,
    dataDays: dates.length,
    monthFactor: season.factors,
    seasonal: season.active,
  };
}

/**
 * 支出の水準の不確かさ(対数の標準偏差)。記録が短いほど大きい。30日分で LEVEL_SIGMA_AT_30、
 * 日数の平方根に反比例して小さくなる(下限・上限あり)。
 */
export const LEVEL_SIGMA_AT_30 = 0.15;
export function levelSigmaFor(dataDays: number): number {
  const days = Math.max(dataDays, 7);
  return Math.min(0.6, Math.max(0.05, LEVEL_SIGMA_AT_30 * Math.sqrt(30 / days)));
}

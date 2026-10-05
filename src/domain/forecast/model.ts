/**
 * 変動費のベイズ階層モデル。カテゴリ×日ごとに「回数」(ポアソン、ガンマ事前分布との共役更新)と
 * 「1回の金額」(対数正規、全カテゴリの平均へ縮小推定)を別々に推定する。曜日・給料日からの日数・
 * 祝日の係数も1.0(効果なし)へ縮小推定する。
 *
 * 直近を重く扱う:観測の重みを 0.5^(経過日数 ÷ 半減期) にする。半減期は本人の過去の月での検証で
 * 30・90・180日から選ぶ(ADR-068)。
 */

import {
  addDays,
  addMonths,
  daysBetween,
  nthDayOfMonth,
  splitDateOnly,
  weekdayOf,
  type DateOnly,
} from '@/lib/date';
import { isDayOff, isHoliday } from './holidays';
import { recordedShare } from './lag';
import {
  PAY_CYCLE_BUCKETS,
  type CategoryDayRecord,
  type CategoryModelParams,
  type FittedModel,
  type VariableTrainingData,
} from './types';

/** 季節の係数を出すのに必要な、記録のそろった月の数。 */
const MIN_MONTHS_FOR_SEASON = 12;
const SEASON_CLAMP = { min: 0.6, max: 1.6 } as const;
const DEFAULT_MONTH_NOISE_VAR = 0.02;
const NO_SEASON: readonly number[] = Array.from({ length: 13 }, () => 1);
const NO_PAY_CYCLE: readonly number[] = Array.from({ length: PAY_CYCLE_BUCKETS }, () => 1);

/** 直近を重く見る重みの半減期(日)の既定値。検証で、本人の記録に合う値を選ぶ。 */
export const DEFAULT_HALF_LIFE_DAYS = 90;
export const RECENCY_HALF_LIFE_CANDIDATES = [30, 90, 180] as const;
/** 回数の事前分布の強さ(7日分の観測に相当する程度)。 */
const COUNT_PRIOR_DAYS = 7;
/**
 * 回数の事前分布の中心 m0 を、全カテゴリの平均と、そのカテゴリの全期間の率で混ぜる強さ。
 * m0 = (件数 × 自分の率 + 10 × 全体の率) ÷ (件数 + 10)。直近の重みが小さいカテゴリ(たまにしか
 * 使わない趣味など)を、全カテゴリの平均ではなく自分の長い目の率へ寄せる。
 */
const OWN_RATE_PRIOR_COUNT = 10;
/**
 * 回数の係数の事前の分散。休み(土日祝)か平日かと、給料日からの区分の効果は大きく(±50%)、
 * 同じ休み・平日の中での曜日ごとの違いと、平日の祝日の違いは小さい(±20%)とみる。
 */
const GROUP_COEF_PRIOR_VAR = 0.5 ** 2;
const RESIDUAL_COEF_PRIOR_VAR = 0.2 ** 2;
/**
 * 1回の金額(対数の平均)の、カテゴリどうしの違いの大きさ(分散)の既定値と範囲。カテゴリの平均は、
 * 「カテゴリの平均の平均」へ、自分の件数が少ないほど寄せる(経験ベイズ)。件数で重みを付けた全体の
 * 平均へ寄せると、回数の多い安い買い物(交通費・コンビニ)に引っ張られ、高いカテゴリが低く出る。
 */
const DEFAULT_BETWEEN_CATEGORY_VAR = 0.5;
const BETWEEN_CATEGORY_VAR_RANGE = { min: 0.1, max: 2 } as const;
/** 休みの日と平日で1回の金額が違うか、を信じる強さ(少ない方の観測件数換算)。 */
const DAY_OFF_AMOUNT_PRIOR = 2;
const DAY_OFF_DELTA_CLAMP = 1.2;
const MIN_SAMPLES_FOR_OWN_VARIANCE = 5;
const FALLBACK_LOG_SIGMA_SQ = 0.7 ** 2;
/** 月ごとの金額の揺れ τ² の既定値と範囲(今月の金額の更新に使う)。 */
export const DEFAULT_MONTH_TAU_SQ = 0.04;
const MONTH_TAU_SQ_RANGE = { min: 0.01, max: 0.25 } as const;
const MIN_MONTHS_FOR_TAU = 3;
const MIN_COUNT_PER_MONTH_FOR_TAU = 3;

/**
 * 記録が一切無いとき(dataDays=0)だけ使う、最後のフォールバック値(1日あたり0.1回、1回1,500円)。
 * 実データが1件でも入ればこの値は使われない。
 */
const FALLBACK_DAILY_RATE = 0.1;
const FALLBACK_LOG_MEAN = Math.log(1500);

function recencyWeight(date: DateOnly, today: DateOnly, halfLifeDays: number): number {
  const ago = Math.max(0, daysBetween(date, today));
  return Math.pow(0.5, ago / halfLifeDays);
}

/** その月の給料日。土日祝なら前の平日にずらす(銀行の営業日に合わせて早まる)。 */
export function paydayOn(dateInMonth: DateOnly, payday: number): DateOnly {
  let day = nthDayOfMonth(dateInMonth, payday);
  for (let i = 0; i < 7 && isDayOff(day); i += 1) day = addDays(day, -1);
  return day;
}

/** 給料日からの日数の区分(0:0〜2日、1:3〜6日、2:7〜13日、3:14〜20日、4:21日以上)。 */
export function payCycleBucket(date: DateOnly, payday: number): number {
  let last = paydayOn(date, payday);
  if (last > date) last = paydayOn(addMonths(nthDayOfMonth(date, 1), -1), payday);
  const days = daysBetween(last, date);
  if (days <= 2) return 0;
  if (days <= 6) return 1;
  if (days <= 13) return 2;
  if (days <= 20) return 3;
  return 4;
}

/** 日付だけで決まる特徴(曜日・給料日からの区分・祝日・休み・月)。何度も使うので1回だけ計算する。 */
export type DayFeature = {
  weekday: number;
  payBucket: number | null;
  holiday: boolean;
  dayOff: boolean;
  month: number;
};

const featureCache = new Map<string, DayFeature>();
export function dayFeature(date: DateOnly, payday: number | null): DayFeature {
  const key = `${date}:${payday ?? ''}`;
  const cached = featureCache.get(key);
  if (cached) return cached;
  const feature: DayFeature = {
    weekday: weekdayOf(date),
    payBucket: payday === null ? null : payCycleBucket(date, payday),
    holiday: isHoliday(date),
    dayOff: isDayOff(date),
    month: splitDateOnly(date)[1],
  };
  if (featureCache.size > 50_000) featureCache.clear();
  featureCache.set(key, feature);
  return feature;
}

type WeightedSum = { countWeighted: number; dayWeight: number };

/** その日の1回ごとの金額の対数の和と二乗和。無ければ、その日の平均額で近似する。 */
function logSumsOf(rec: CategoryDayRecord): { sum: number; sqSum: number } {
  if (rec.logSum !== undefined && rec.logSqSum !== undefined) {
    return { sum: rec.logSum, sqSum: rec.logSqSum };
  }
  const log = Math.log(Math.max(1, rec.amountYen / rec.count));
  return { sum: rec.count * log, sqSum: rec.count * log * log };
}

/**
 * 条件ごとの率の比を、目標(世帯全体の効果、または1.0)へ寄せる(経験ベイズ)。証拠の量は日数では
 * なく「その条件での期待回数」で測る:比の推定の揺れは 1/回数 ほど、効果の事前の幅は priorVar。
 * 毎日買うカテゴリの土曜の効果はほぼそのまま信じ、たまにしか買わないカテゴリの効果は強く寄せる。
 */
function shrinkTo(sub: WeightedSum, overallRate: number, target: number, priorVar: number): number {
  if (sub.dayWeight <= 0 || overallRate <= 0) return target;
  const raw = sub.countWeighted / sub.dayWeight / overallRate;
  const expectedCount = overallRate * Math.max(target, 0.05) * sub.dayWeight;
  const shrink = priorVar / (priorVar + 1 / Math.max(expectedCount, 1e-6));
  return target + shrink * (raw - target);
}

/** 休み・平日、曜日(祝日を除く)、平日の祝日、給料日からの区分ごとの回数と日数。 */
type CoefficientSums = {
  dayOff: WeightedSum;
  workday: WeightedSum;
  weekday: WeightedSum[];
  weekdayHoliday: WeightedSum;
  pay: WeightedSum[];
  count: number;
  exposure: number;
};

function emptySums(): CoefficientSums {
  const sum = () => ({ countWeighted: 0, dayWeight: 0 });
  return {
    dayOff: sum(),
    workday: sum(),
    weekday: Array.from({ length: 7 }, sum),
    weekdayHoliday: sum(),
    pay: Array.from({ length: PAY_CYCLE_BUCKETS }, sum),
    count: 0,
    exposure: 0,
  };
}

function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

function addTo(sum: WeightedSum, count: number, exposure: number): void {
  sum.countWeighted += count;
  sum.dayWeight += exposure;
}

function addDay(sums: CoefficientSums, f: DayFeature, count: number, exposure: number): void {
  addTo(f.dayOff ? sums.dayOff : sums.workday, count, exposure);
  if (f.holiday && !isWeekend(f.weekday)) addTo(sums.weekdayHoliday, count, exposure);
  else addTo(sums.weekday[f.weekday]!, count, exposure);
  if (f.payBucket !== null) addTo(sums.pay[f.payBucket]!, count, exposure);
  sums.count += count;
  sums.exposure += exposure;
}

type Coefficients = { weekday: number[]; pay: number[]; holiday: number };

/**
 * 回数の係数。まず休み・平日の効果を1.0へ寄せて求め(休みの日はまとめて数えるので証拠が多い)、
 * 曜日ごとの係数は、その曜日が属する側(土日=休み、月〜金=平日)の効果へ寄せる。平日の祝日は、
 * 休みの効果へ寄せる(rateFactor は平日の祝日にだけ holidayFactor を掛ける)。
 */
function coefficientsOf(sums: CoefficientSums): Coefficients {
  const rate = sums.exposure > 0 ? sums.count / sums.exposure : 0;
  const off = shrinkTo(sums.dayOff, rate, 1, GROUP_COEF_PRIOR_VAR);
  const on = shrinkTo(sums.workday, rate, 1, GROUP_COEF_PRIOR_VAR);
  const weekday = sums.weekday.map((w, i) => {
    const group = isWeekend(i) ? off : on;
    return group * shrinkTo(w, rate * group, 1, RESIDUAL_COEF_PRIOR_VAR);
  });
  const holiday =
    on > 0 ? shrinkTo(sums.weekdayHoliday, rate * on, off / on, RESIDUAL_COEF_PRIOR_VAR) : 1;
  return {
    weekday,
    pay: sums.pay.map((w) => shrinkTo(w, rate, 1, GROUP_COEF_PRIOR_VAR)),
    holiday,
  };
}

/**
 * 月ごとの季節の係数(添字1〜12)。記録のそろった月が12か月以上あるときだけ出す。
 *
 * 各月の1日あたりの支出を、その月を中心にした前後6か月の1日あたりの支出で割った比を使う
 * (ゆるやかな増加・減少を季節と取り違えない)。同じ月の比を平均し、年ごとのばらつき(雑音)と
 * 月どうしの違い(季節)の大きさから、信じる割合を決めて1.0へ寄せる(経験ベイズ)。
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
  const complete: { key: string; month: number; mean: number }[] = [];
  for (const [key, acc] of monthSum) {
    const monthStart = `${key}-01`;
    const daysInMonth = daysBetween(monthStart, addMonths(monthStart, 1));
    if (acc.days === daysInMonth && monthStart >= first && acc.days > 0) {
      complete.push({ key, month: splitDateOnly(monthStart)[1], mean: acc.sum / acc.days });
    }
  }
  if (complete.length < MIN_MONTHS_FOR_SEASON) return { factors: NO_SEASON, active: false };
  complete.sort((a, b) => a.key.localeCompare(b.key));

  // 前後6か月(その月を除く、そろった月だけ)の平均に対する比。
  const ratios: { month: number; ratio: number }[] = [];
  for (let i = 0; i < complete.length; i += 1) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 6); j <= Math.min(complete.length - 1, i + 6); j += 1) {
      if (j === i) continue;
      sum += complete[j]!.mean;
      n += 1;
    }
    if (n >= 6 && sum > 0)
      ratios.push({ month: complete[i]!.month, ratio: complete[i]!.mean / (sum / n) });
  }
  const byMonth = Array.from({ length: 13 }, () => [] as number[]);
  for (const r of ratios) byMonth[r.month]!.push(r.ratio);
  // 雑音:同じ月の比の、年ごとのばらつき。季節:月ごとの平均の、月どうしのばらつき。
  let noiseSum = 0;
  let noiseDf = 0;
  const means: { month: number; mean: number; n: number }[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const list = byMonth[month]!;
    if (list.length === 0) continue;
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    means.push({ month, mean, n: list.length });
    for (const v of list) noiseSum += (v - mean) ** 2;
    noiseDf += list.length - 1;
  }
  if (means.length < 6) return { factors: NO_SEASON, active: false };
  // 1年分しか無いと年ごとの揺れを測れないので、家計でよくある月ごとの揺れ(±14%)を仮に置く。
  const noiseVar = noiseDf > 0 ? noiseSum / noiseDf : DEFAULT_MONTH_NOISE_VAR;
  const grand = means.reduce((a, b) => a + b.mean, 0) / means.length;
  const spread =
    means.reduce((a, b) => a + (b.mean - grand) ** 2, 0) / Math.max(1, means.length - 1);
  const avgN = means.reduce((a, b) => a + b.n, 0) / means.length;
  const signalVar = Math.max(0, spread - noiseVar / avgN);

  const factors = [1, ...Array.from({ length: 12 }, () => 1)];
  for (const { month, mean, n } of means) {
    const weight = signalVar > 0 ? signalVar / (signalVar + noiseVar / n) : 0;
    factors[month] = Math.min(
      SEASON_CLAMP.max,
      Math.max(SEASON_CLAMP.min, 1 + weight * (mean / grand - 1)),
    );
  }
  return { factors, active: true };
}

type RateCoefficients = Pick<
  CategoryModelParams,
  'weekdayFactor' | 'payCycleFactor' | 'holidayFactor'
>;

/** その日の回数の係数(曜日 × 給料日からの区分 × 祝日 × 月の季節)。 */
export function rateFactor(
  cat: RateCoefficients,
  date: DateOnly,
  payday: number | null,
  monthFactor: readonly number[] = NO_SEASON,
): number {
  const f = dayFeature(date, payday);
  let factor = cat.weekdayFactor[f.weekday] ?? 1;
  if (f.payBucket !== null) factor *= cat.payCycleFactor[f.payBucket] ?? 1;
  // 土日の祝日は、すでに土日の係数に休みの効果が入っているので掛けない。
  if (f.holiday && !isWeekend(f.weekday)) factor *= cat.holidayFactor;
  factor *= monthFactor[f.month] ?? 1;
  return Math.max(0, factor);
}

/** rateFactor の合計を、休みの日(土日祝)と平日に分けた値。休みの日は1回の金額が違うため。 */
export function rateFactorSplit(
  cat: RateCoefficients,
  dates: readonly DateOnly[],
  payday: number | null,
  monthFactor: readonly number[] = NO_SEASON,
): { dayOff: number; weekday: number } {
  let dayOff = 0;
  let weekday = 0;
  for (const date of dates) {
    const factor = rateFactor(cat, date, payday, monthFactor);
    if (dayFeature(date, payday).dayOff) dayOff += factor;
    else weekday += factor;
  }
  return { dayOff, weekday };
}

export function rateFactorSum(
  cat: RateCoefficients,
  dates: readonly DateOnly[],
  payday: number | null,
  monthFactor: readonly number[] = NO_SEASON,
): number {
  const { dayOff, weekday } = rateFactorSplit(cat, dates, payday, monthFactor);
  return dayOff + weekday;
}

/**
 * 月ごとの1回の金額(対数の平均)が、全体の平均からどれだけ揺れるか τ²。月ごとの平均の
 * ばらつきから、件数が少ないことによる揺れ(σ²/件数)を引いた値。月が少なければ既定値。
 */
function monthTauSq(cat: VariableTrainingData, mu: number, sigmaSq: number): number {
  const byMonth = new Map<string, { logSum: number; count: number }>();
  for (const rec of cat.days) {
    if (rec.count === 0) continue;
    const key = rec.date.slice(0, 7);
    const acc = byMonth.get(key) ?? { logSum: 0, count: 0 };
    acc.logSum += logSumsOf(rec).sum;
    acc.count += rec.count;
    byMonth.set(key, acc);
  }
  const months = [...byMonth.values()].filter((m) => m.count >= MIN_COUNT_PER_MONTH_FOR_TAU);
  if (months.length < MIN_MONTHS_FOR_TAU) return DEFAULT_MONTH_TAU_SQ;
  let deviation = 0;
  let sampling = 0;
  for (const m of months) {
    deviation += (m.logSum / m.count - mu) ** 2;
    sampling += sigmaSq / m.count;
  }
  const raw = (deviation - sampling) / months.length;
  return Math.min(MONTH_TAU_SQ_RANGE.max, Math.max(MONTH_TAU_SQ_RANGE.min, raw));
}

function fitCategory(
  cat: VariableTrainingData,
  weightByDate: ReadonlyMap<DateOnly, number>,
  exposureByDate: ReadonlyMap<DateOnly, number>,
  pooledDailyRate: number,
  amountPrior: { mean: number; variance: number },
  payday: number | null,
  monthFactor: readonly number[],
): CategoryModelParams {
  let weightedCount = 0;
  let weight = 0;
  let rawCount = 0;
  let rawExposure = 0;
  let logSum = 0;
  let logSqSum = 0;
  let logWeight = 0;
  let rawAmountCount = 0;
  const off = { logSum: 0, weight: 0 };
  const on = { logSum: 0, weight: 0 };
  const sums = emptySums();
  for (const rec of cat.days) {
    const w = weightByDate.get(rec.date) ?? 0;
    // 直近の日は、まだ記録されていない分がある(入力の遅れ)。その日の「観測できた割合」を掛ける。
    const exposure = exposureByDate.get(rec.date) ?? 1;
    const f = dayFeature(rec.date, payday);
    // 季節の係数がある月は、その分を取り除いた回数で学習する(夏に多い分を平常の率に混ぜない)。
    const count = rec.count / (monthFactor[f.month] || 1);
    weightedCount += w * count;
    weight += w * exposure;
    rawCount += count;
    rawExposure += exposure;

    // 曜日・給料日・祝日の係数は暮らしの形(何曜日に多いか)なので、直近の重みを掛けずに
    // 記録の全期間で見る。重みを掛けると、証拠の量が直近の数十日ぶんに減り、1.0へ寄りすぎる。
    addDay(sums, f, count, exposure);

    if (rec.count > 0) {
      const logs = logSumsOf(rec);
      logSum += w * logs.sum;
      logSqSum += w * logs.sqSum;
      logWeight += w * rec.count;
      rawAmountCount += rec.count;
      const bucket = f.dayOff ? off : on;
      bucket.logSum += w * logs.sum;
      bucket.weight += w * rec.count;
    }
  }

  // 事前分布の中心 m0:そのカテゴリの全期間の率と、全カテゴリの平均を件数で混ぜる。
  const ownRate = rawExposure > 0 ? rawCount / rawExposure : pooledDailyRate;
  const m0 =
    (rawCount * ownRate + OWN_RATE_PRIOR_COUNT * pooledDailyRate) /
    (rawCount + OWN_RATE_PRIOR_COUNT);
  const countPosterior = {
    alpha: m0 * COUNT_PRIOR_DAYS + weightedCount,
    beta: COUNT_PRIOR_DAYS + weight,
  };

  const rawMu = logWeight > 0 ? logSum / logWeight : amountPrior.mean;
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
  // カテゴリの平均を、件数(重みなし)が少ないほど「カテゴリの平均の平均」へ寄せる。
  const ownWeight =
    rawAmountCount > 0
      ? amountPrior.variance / (amountPrior.variance + totalSigmaSq / rawAmountCount)
      : 0;
  const mu = amountPrior.mean + ownWeight * (rawMu - amountPrior.mean);

  const coefficients = coefficientsOf(sums);

  return {
    categoryId: cat.categoryId,
    categoryName: cat.categoryName,
    countPosterior,
    amountPosterior: { mu, sigmaSq, kappa: rawAmountCount + totalSigmaSq / amountPrior.variance },
    monthTauSq: monthTauSq(cat, mu, sigmaSq),
    dayOffAmount: { delta, share: offShare },
    weekdayFactor: coefficients.weekday,
    payCycleFactor: payday === null ? NO_PAY_CYCLE : coefficients.pay,
    holidayFactor: coefficients.holiday,
    dataDays: cat.days.length,
  };
}

/** カテゴリの平均の平均と、カテゴリどうしの違いの分散(件数が3件以上のカテゴリから)。 */
function categoryAmountPrior(
  variable: readonly VariableTrainingData[],
  fallbackMean: number,
): { mean: number; variance: number } {
  const means: number[] = [];
  for (const cat of variable) {
    let sum = 0;
    let count = 0;
    for (const rec of cat.days) {
      if (rec.count === 0) continue;
      sum += logSumsOf(rec).sum;
      count += rec.count;
    }
    if (count >= 3) means.push(sum / count);
  }
  if (means.length === 0) return { mean: fallbackMean, variance: DEFAULT_BETWEEN_CATEGORY_VAR };
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  const variance =
    means.length >= 3
      ? means.reduce((a, m) => a + (m - mean) ** 2, 0) / (means.length - 1)
      : DEFAULT_BETWEEN_CATEGORY_VAR;
  return {
    mean,
    variance: Math.min(
      BETWEEN_CATEGORY_VAR_RANGE.max,
      Math.max(BETWEEN_CATEGORY_VAR_RANGE.min, variance),
    ),
  };
}

export function fitModel(input: {
  variable: readonly VariableTrainingData[];
  today: DateOnly;
  /** 給料日(1〜31)。無ければ給料日の係数は常に1.0。 */
  payday: number | null;
  /** 直近を重く見る重みの半減期(日)。 */
  halfLifeDays?: number;
  /** 入力の遅れ D(j)。直近の日の「観測できた割合」に使う。 */
  entryLag?: readonly number[] | null;
}): FittedModel {
  const { variable, today, payday } = input;
  const halfLife = input.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const dates = variable[0]?.days.map((d) => d.date) ?? [];
  const weightByDate = new Map(dates.map((d) => [d, recencyWeight(d, today, halfLife)]));
  const lag = input.entryLag ?? null;
  const exposureByDate = new Map(
    dates.map((d) => [d, Math.max(0.05, recordedShare(lag, daysBetween(d, today)))]),
  );

  let pooledWeightedCount = 0;
  let pooledWeight = 0;
  let pooledLogSum = 0;
  let pooledLogWeight = 0;
  for (const cat of variable) {
    for (const rec of cat.days) {
      const w = weightByDate.get(rec.date) ?? 0;
      pooledWeightedCount += w * rec.count;
      pooledWeight += w * (exposureByDate.get(rec.date) ?? 1);
      if (rec.count > 0) {
        pooledLogSum += w * logSumsOf(rec).sum;
        pooledLogWeight += w * rec.count;
      }
    }
  }
  const pooledDailyRate =
    pooledWeight > 0 ? pooledWeightedCount / pooledWeight : FALLBACK_DAILY_RATE;
  const pooledLogMean = pooledLogWeight > 0 ? pooledLogSum / pooledLogWeight : FALLBACK_LOG_MEAN;
  const amountPrior = categoryAmountPrior(variable, pooledLogMean);

  const season = seasonalFactors(variable, today);
  const categories = variable.map((cat) =>
    fitCategory(
      cat,
      weightByDate,
      exposureByDate,
      pooledDailyRate,
      amountPrior,
      payday,
      season.factors,
    ),
  );

  return {
    categories,
    pooledDailyRate,
    dataDays: dates.length,
    monthFactor: season.factors,
    seasonal: season.active,
  };
}

/**
 * 今月の水準 L の事前分布の強さ k の候補。L ~ Gamma(k, k)(平均1、ばらつき 1/√k)を、今月の記録の
 * 回数 n と期待回数 E で Gamma(k + n, k + E) に更新する。k=∞ は「今月の水準を見ない」(L=1)。
 */
export const MONTH_LEVEL_K_CANDIDATES = [3, 8, 20, Infinity] as const;
export const DEFAULT_MONTH_LEVEL_K = 8;

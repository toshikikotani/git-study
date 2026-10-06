/**
 * 予測の補正を、本人の過去の月で求める(半減期 × 今月の水準の強さ、時点帯ごとの中心、PIT)。
 *
 * 毎回のページ表示でバックテストを回すと重いので、明細が変わらない間は同じ結果を使い回す
 * (明細の件数・最新日・合計が変わると鍵が変わり、求め直す)。サーバーのメモリ内だけの
 * 使い回しで、ユーザーごとに分ける(他人の結果を返さない)。
 */

import {
  DEFAULT_HALF_LIFE_DAYS,
  DEFAULT_MONTH_LEVEL_K,
  GENRE_LEVEL_K_CANDIDATES,
  MONTH_LEVEL_K_CANDIDATES,
  RECENCY_HALF_LIFE_CANDIDATES,
} from '@/domain/forecast/model';
import {
  backtestGrid,
  calibrateFromBacktest,
  runBacktest,
  type BacktestPoint,
} from '@/domain/forecast/backtest';
import type { CautionPrecision } from '@/domain/forecast/caution';
import { rawLevelFor } from '@/domain/forecast/pit';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import type { ForecastCalibration } from '@/domain/forecast/types';
import { addDays, addMonths, daysBetween, nthDayOfMonth, type DateOnly } from '@/lib/date';

/** 検証に使う、直近の完了した月の数の上限。 */
const MAX_BACKTEST_MONTHS = 6;
/** 検証の試行回数(本番より少なくして軽くする)。 */
const BACKTEST_TRIALS = 500;
/** 半減期 × k を比べるときの試行回数と時点の間隔(さらに軽くする)。 */
const SELECTION_TRIALS = 250;
const SELECTION_STEP_DAYS = 6;
/** 検証する月の前に、最低これだけの記録日数が要る。 */
const MIN_HISTORY_DAYS = 30;
const TRAINING_WINDOW_DAYS = 730;
const CACHE_LIMIT = 20;

export type VerificationSummary = {
  pointCount: number;
  months: number;
  /** 補正の前の、80%の幅の的中率と、中央値の誤差(絶対値の平均)。 */
  hitRate80: number;
  medianAbsErrorRatio: number;
  /** 補正の後の、80%の幅の的中率と、符号つきの中央値の誤差(同じ月で求めた補正を当てた値)。 */
  calibratedHitRate80: number;
  calibratedBias: number;
};

export type Verification = {
  calibration: ForecastCalibration | null;
  /** 検証で選んだ、直近を重く見る重みの半減期(日)と、今月の水準の強さ k。 */
  halfLifeDays: number;
  /** null は「今月の水準を見ない」(k=∞)。サーバーのキャッシュ(JSON)に Infinity を置けないため。 */
  monthLevelK: number | null;
  /** ジャンルごとの水準の強さ k_g(設計書 v3 4.2)。null は使わない(∞)。 */
  genreLevelK: number | null;
  summary: VerificationSummary;
};

/** 直近の完了した月(古い順)。記録開始から十分な日数のある月だけ。 */
export function backtestMonths(
  today: DateOnly,
  recordStart: DateOnly | null,
): { from: DateOnly; to: DateOnly }[] {
  if (recordStart === null) return [];
  const thisMonth = nthDayOfMonth(today, 1);
  const out: { from: DateOnly; to: DateOnly }[] = [];
  for (let i = 1; i <= MAX_BACKTEST_MONTHS; i += 1) {
    const from = addMonths(thisMonth, -i);
    const to = addDays(addMonths(from, 1), -1);
    if (daysBetween(recordStart, from) < MIN_HISTORY_DAYS) break;
    out.unshift({ from, to });
  }
  return out;
}

/** 補正を当てたときの、80%の幅の的中率と中央値の符号つき誤差。 */
export function calibratedScores(
  points: readonly BacktestPoint[],
  calibration: ForecastCalibration | null,
): { hitRate80: number; bias: number } {
  if (points.length === 0) return { hitRate80: 0, bias: 0 };
  let hits = 0;
  let bias = 0;
  for (const p of points) {
    const cal = calibration
      ? { pit: calibration.pitByPhase[p.phase], pitWeight: calibration.pitWeight }
      : null;
    const lo = rawLevelFor(cal, 0.1);
    const mid = rawLevelFor(cal, 0.5);
    const hi = rawLevelFor(cal, 0.9);
    const factor = calibration?.centerByPhase[p.phase] ?? 1;
    const at = (q: number) => {
      const idx = Math.min(p.samples.length - 1, Math.round(q * (p.samples.length - 1)));
      return p.knownYen + (p.samples[idx]! - p.knownYen) * factor;
    };
    if (p.actualTotal >= at(lo) && p.actualTotal <= at(hi)) hits += 1;
    bias += (at(mid) - p.actualTotal) / Math.max(1, p.actualTotal);
  }
  return { hitRate80: hits / points.length, bias: bias / points.length };
}

const cache = new Map<string, Verification | null>();

export function verifyForecast(input: {
  /** ユーザーと明細の版を含む鍵。 */
  cacheKey: string;
  transactions: readonly ForecastSourceTransaction[];
  today: DateOnly;
  recordStart: DateOnly | null;
  payday: number | null;
  noForecastGenreIds?: ReadonlySet<string>;
}): Verification | null {
  if (cache.has(input.cacheKey)) return cache.get(input.cacheKey) ?? null;
  const periods = backtestMonths(input.today, input.recordStart);
  let result: Verification | null = null;
  if (periods.length > 0) {
    const base = {
      transactions: input.transactions,
      periods,
      trainingWindowDays: TRAINING_WINDOW_DAYS,
      recordStart: input.recordStart,
      payday: input.payday,
      ...(input.noForecastGenreIds ? { noForecastGenreIds: input.noForecastGenreIds } : {}),
    };
    // 半減期 × k を、軽い試行・粗い時点で比べ(CRPS が最小のもの)、選んだ組で2日おきに検証し直す。
    const grid = backtestGrid({
      ...base,
      halfLives: RECENCY_HALF_LIFE_CANDIDATES,
      monthLevelKs: MONTH_LEVEL_K_CANDIDATES,
      trials: SELECTION_TRIALS,
      stepDays: SELECTION_STEP_DAYS,
    });
    const best = grid.reduce<(typeof grid)[number] | null>(
      (a, b) => (a === null || b.meanCrps < a.meanCrps ? b : a),
      null,
    ) ?? {
      halfLifeDays: DEFAULT_HALF_LIFE_DAYS,
      monthLevelK: DEFAULT_MONTH_LEVEL_K,
      genreLevelK: Infinity,
      meanCrps: 0,
    };
    // ジャンルごとの水準 k_g は、選んだ半減期 × k のうえで比べる(全部の組み合わせは重い)。
    const genreGrid = Number.isFinite(best.monthLevelK)
      ? backtestGrid({
          ...base,
          halfLives: [best.halfLifeDays],
          monthLevelKs: [best.monthLevelK],
          genreLevelKs: GENRE_LEVEL_K_CANDIDATES,
          trials: SELECTION_TRIALS,
          stepDays: SELECTION_STEP_DAYS,
        })
      : [];
    const bestGenre = genreGrid.reduce<(typeof genreGrid)[number] | null>(
      (a, b) => (a === null || b.meanCrps < a.meanCrps ? b : a),
      null,
    );
    const genreLevelK = bestGenre?.genreLevelK ?? Infinity;
    const backtest = runBacktest({
      ...base,
      halfLifeDays: best.halfLifeDays,
      monthLevelK: best.monthLevelK,
      genreLevelK,
      trials: BACKTEST_TRIALS,
      stepDays: 2,
    });
    if (backtest.points.length > 0) {
      const calibration = calibrateFromBacktest(backtest.points, periods.length);
      const after = calibratedScores(backtest.points, calibration);
      result = {
        calibration,
        halfLifeDays: best.halfLifeDays,
        monthLevelK: Number.isFinite(best.monthLevelK) ? best.monthLevelK : null,
        genreLevelK: Number.isFinite(genreLevelK) ? genreLevelK : null,
        summary: {
          pointCount: backtest.points.length,
          months: periods.length,
          hitRate80: backtest.hitRate80,
          medianAbsErrorRatio: backtest.medianAbsErrorRatio,
          calibratedHitRate80: after.hitRate80,
          calibratedBias: after.bias,
        },
      };
    }
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(input.cacheKey, result);
  return result;
}

/** 注意の精度を測るときの試行回数と時点の間隔(検証より軽くする)。 */
const CAUTION_TRIALS = 300;
const CAUTION_STEP_DAYS = 4;
const cautionCache = new Map<string, CautionPrecision>();

/**
 * 注意の精度(設計書 v3 3.2):今の目標を過去の月にも当てて、本番と同じ規則で出した注意が
 * 実際に当たった(月末に目標を超えた)割合を、時点帯ごとに数える。精度が 70% 未満の時点帯では
 * 画面に注意を出さない。目標(30日あたり)が変わると鍵が変わる。
 */
export function verifyCautions(input: {
  cacheKey: string;
  transactions: readonly ForecastSourceTransaction[];
  today: DateOnly;
  recordStart: DateOnly | null;
  payday: number | null;
  noForecastGenreIds?: ReadonlySet<string>;
  verification: Verification | null;
  targets: readonly { categoryId: string; targetYen: number }[];
}): CautionPrecision {
  const hit = cautionCache.get(input.cacheKey);
  if (hit) return hit;
  const periods = backtestMonths(input.today, input.recordStart);
  let result: CautionPrecision = {};
  if (periods.length > 0 && input.targets.length > 0) {
    result = runBacktest({
      transactions: input.transactions,
      periods,
      trainingWindowDays: TRAINING_WINDOW_DAYS,
      recordStart: input.recordStart,
      payday: input.payday,
      ...(input.noForecastGenreIds ? { noForecastGenreIds: input.noForecastGenreIds } : {}),
      halfLifeDays: input.verification?.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS,
      monthLevelK: input.verification
        ? (input.verification.monthLevelK ?? Infinity)
        : DEFAULT_MONTH_LEVEL_K,
      genreLevelK: input.verification?.genreLevelK ?? Infinity,
      trials: CAUTION_TRIALS,
      stepDays: CAUTION_STEP_DAYS,
      cautionTargets: input.targets,
    }).cautionPrecision;
  }
  if (cautionCache.size >= CACHE_LIMIT) {
    cautionCache.delete(cautionCache.keys().next().value as string);
  }
  cautionCache.set(input.cacheKey, result);
  return result;
}

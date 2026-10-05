/**
 * 幅の補正係数を、本人の過去の月で求める(M4をアプリの中で動かす)。
 *
 * 毎回のページ表示でバックテストを回すと重いので、明細が変わらない間は同じ結果を使い回す
 * (明細の件数・最新日・合計が変わると鍵が変わり、求め直す)。サーバーのメモリ内だけの
 * 使い回しで、ユーザーごとに分ける(他人の結果を返さない)。
 */

import { RECENCY_HALF_LIFE_CANDIDATES } from '@/domain/forecast/model';
import {
  calibrateWidth,
  runBacktest,
  type BacktestSummary,
  type CalibrationResult,
} from '@/domain/forecast/backtest';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { addDays, addMonths, daysBetween, nthDayOfMonth, type DateOnly } from '@/lib/date';

/** 検証に使う、直近の完了した月の数の上限。 */
const MAX_BACKTEST_MONTHS = 6;
/** 検証の試行回数(本番より少なくして軽くする。幅の補正が目的なので十分)。 */
const BACKTEST_TRIALS = 600;
/** 半減期を比べるときの試行回数(さらに軽くする)。 */
const SELECTION_TRIALS = 300;
/** 検証する月の前に、最低これだけの記録日数が要る。 */
const MIN_HISTORY_DAYS = 30;
const TRAINING_WINDOW_DAYS = 730;
const CACHE_LIMIT = 20;

/** 記録が90日以上あればアンサンブル(ベイズ+ブートストラップ)、それ未満はベイズのみ。 */
export function bootstrapWeightFor(dataDays: number): number {
  return dataDays >= 90 ? 0.5 : 0;
}

export type Verification = {
  calibration: CalibrationResult;
  /** 検証で選んだ、直近を重く見る重みの半減期(日)。 */
  halfLifeDays: number;
  /** 検証した月の数と、80%の幅の的中率・中央値の誤差(補正の前)。 */
  summary: Pick<BacktestSummary, 'hitRate80' | 'medianAbsErrorRatio'> & { pointCount: number };
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

const cache = new Map<string, Verification | null>();

export function verifyForecast(input: {
  /** ユーザーと明細の版を含む鍵。 */
  cacheKey: string;
  transactions: readonly ForecastSourceTransaction[];
  today: DateOnly;
  recordStart: DateOnly | null;
  payday: number | null;
  bootstrapWeight: number;
}): Verification | null {
  if (cache.has(input.cacheKey)) return cache.get(input.cacheKey) ?? null;
  const periods = backtestMonths(input.today, input.recordStart);
  let result: Verification | null = null;
  if (periods.length > 0) {
    const run = (halfLifeDays: number, trials: number) =>
      runBacktest({
        transactions: input.transactions,
        periods,
        trainingWindowDays: TRAINING_WINDOW_DAYS,
        recordStart: input.recordStart,
        payday: input.payday,
        halfLifeDays,
        bootstrapWeight: input.bootstrapWeight,
        trials,
      });
    // 半減期の候補を、軽い試行で比べて(確率予測の誤差 CRPS が最小のもの)選び、
    // 選んだ値でもう一度、補正用の検証を回す。
    const scored = RECENCY_HALF_LIFE_CANDIDATES.map((halfLifeDays) => ({
      halfLifeDays,
      meanCrps: run(halfLifeDays, SELECTION_TRIALS).meanCrps,
    }));
    const best = scored.reduce((a, b) => (b.meanCrps < a.meanCrps ? b : a));
    const backtest = run(best.halfLifeDays, BACKTEST_TRIALS);
    if (backtest.points.length > 0) {
      result = {
        calibration: calibrateWidth(backtest.points),
        halfLifeDays: best.halfLifeDays,
        summary: {
          hitRate80: backtest.hitRate80,
          medianAbsErrorRatio: backtest.medianAbsErrorRatio,
          pointCount: backtest.points.length,
        },
      };
    }
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(input.cacheKey, result);
  return result;
}

/**
 * M1〜M3をつなぐ入口。呼び出し側(features/forecast/store.ts)は明細を渡すだけで
 * よく、分解・モデル推定・シミュレーションの手順をここに閉じ込める。
 */

import { remainingDays as remainingDaysOf } from '@/domain/period';
import type { DetectedSubscription } from '@/domain/subscriptions';
import type { DateOnly } from '@/lib/date';
import { applyWidthFactor, type CalibrationResult } from './backtest';
import { decomposeSpending, type ForecastSourceTransaction } from './decompose';
import { fitModel } from './model';
import { DEFAULT_TRIALS, simulateForecast, type SimulateInput } from './simulate';
import type { DecomposedSpending, FittedModel, Forecast } from './types';

export type BuildForecastInput = {
  transactions: readonly ForecastSourceTransaction[];
  period: { from: DateOnly; to: DateOnly };
  today: DateOnly;
  trainingFrom: DateOnly;
  recordStart: DateOnly | null;
  confirmedFixedKeys: ReadonlySet<string>;
  detectedSubscriptions: readonly DetectedSubscription[];
  budgetYen: number | null;
  payday: number | null;
  /** 明細が変わるたびに変える識別子(件数+最新日付など)。同じなら同じ結果になる。 */
  dataVersion: string;
  /** 0=ベイズのみ、1=ブートストラップのみ(M4の検証結果で決める。既定はベイズのみ)。 */
  bootstrapWeight?: number;
  trials?: number;
  /**
   * M4のバックテストで求めた幅の補正係数。毎回その場でバックテストを
   * 走らせるのは重いため、呼び出し側が別途(定期ジョブ等で)計算した値を
   * 渡す形にした。無ければ補正なし(widthFactor=1相当)で返す。
   */
  calibration?: CalibrationResult | null;
  /** カテゴリ別の目標(予算)。目標超えの確率に使う。 */
  categoryTargets?: ReadonlyMap<string, number>;
};

export function buildForecast(input: BuildForecastInput): Forecast {
  return buildForecastDetailed(input).forecast;
}

/**
 * 画面(M6)向け。予測結果に加えて、内訳の表示と打ち手の試算(M5)に使う
 * 分解結果・推定済みモデル・シミュレーションの入力も返す。
 */
export function buildForecastDetailed(input: BuildForecastInput): {
  forecast: Forecast;
  decomposed: DecomposedSpending;
  fitted: FittedModel;
  simulateInput: SimulateInput;
} {
  const decomposed = decomposeSpending({
    transactions: input.transactions,
    period: input.period,
    today: input.today,
    trainingFrom: input.trainingFrom,
    recordStart: input.recordStart,
    confirmedFixedKeys: input.confirmedFixedKeys,
    detectedSubscriptions: input.detectedSubscriptions,
  });

  const fitted = fitModel({
    variable: decomposed.variable,
    today: input.today,
    payday: input.payday,
  });

  const periodId = `${input.period.from}_${input.period.to}`;
  const seed = `${periodId}:${input.dataVersion}`;
  const remaining = remainingDaysOf(input.period.from, input.period.to, input.today);

  const simulateInput: SimulateInput = {
    periodId,
    today: input.today,
    periodTo: input.period.to,
    remainingDays: remaining,
    fitted,
    committedYen: decomposed.committed.scheduledYen + decomposed.committed.fixedYen,
    actualYen: decomposed.actualYen,
    specialHistoricalAmounts: decomposed.special.historicalAmounts,
    specialOccurrencesPerDay: decomposed.special.occurrencesPerDay,
    budgetYen: input.budgetYen,
    payday: input.payday,
    bootstrapWeight: input.bootstrapWeight ?? 0,
    trials: input.trials ?? DEFAULT_TRIALS,
    seed,
    categoryBases: decomposed.periodByCategory,
    ...(input.categoryTargets ? { categoryTargets: input.categoryTargets } : {}),
  };
  const raw = simulateForecast(simulateInput);

  const withCommitted: Forecast = {
    ...raw,
    committed: {
      scheduledYen: decomposed.committed.scheduledYen,
      fixedYen: decomposed.committed.fixedYen,
    },
  };

  const result = { decomposed, fitted, simulateInput };
  if (!input.calibration || input.calibration.widthFactor === 1) {
    return { ...result, forecast: { ...withCommitted, calibration: input.calibration ?? null } };
  }

  const factor = input.calibration.widthFactor;
  const totalBand = applyWidthFactor(withCommitted.total, factor);
  return {
    ...result,
    forecast: {
      ...withCommitted,
      total: { ...withCommitted.total, p10: totalBand.p10, p90: totalBand.p90 },
      byCategory: withCommitted.byCategory.map((c) => ({
        ...c,
        ...applyWidthFactor(c, factor),
        landing: applyWidthFactor(c.landing, factor),
      })),
      calibration: input.calibration,
    },
  };
}

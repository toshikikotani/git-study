/**
 * 予測の入口。呼び出し側は明細を渡すだけでよく、分解・モデル推定・シミュレーション・
 * 幅の補正の手順はここ(と pipeline.ts)に閉じ込める。レポート・目標の着地・
 * 目標の分析は、すべてこの1本の予測から出す(予測の仕組みを画面ごとに持たない)。
 */

import { splitDateOnly, type DateOnly } from '@/lib/date';
import type { DetectedSubscription } from '@/domain/subscriptions';
import { applyWidthFactor, type CalibrationResult } from './backtest';
import type { ForecastSourceTransaction } from './decompose';
import { prepareSimulation, type ForecastScope } from './pipeline';
import { DEFAULT_TRIALS, simulateForecast, type CategoryTarget } from './simulate';
import type { Band, Forecast } from './types';

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
   * 走らせるのは重いため、呼び出し側が別途計算した値を渡す(features/forecast/calibration.ts)。
   * 無ければ補正なし(widthFactor=1相当)で返す。
   */
  calibration?: CalibrationResult | null;
  /** 数える範囲(目標のジャンルだけ・特別費を除く、など)。 */
  scope?: ForecastScope;
  /** 目標額のあるカテゴリ。ジャンルごとに「目標を超える確率」を出す。 */
  categoryTargets?: readonly CategoryTarget[];
};

function widen(band: Band, factor: number): Band {
  const wide = applyWidthFactor(band, factor);
  // p70 は中央と上端の間に置く(幅を変えても、p50 ≤ p70 ≤ p90 の並びを保つ)。
  const p70 = band.p50 + (band.p70 - band.p50) * factor;
  return { ...wide, p70: Math.min(wide.p90, Math.max(wide.p50, p70)) };
}

export function buildForecast(input: BuildForecastInput): Forecast {
  const periodId = `${input.period.from}_${input.period.to}`;
  const { decomposed, simulateInput } = prepareSimulation({
    transactions: input.transactions,
    period: input.period,
    today: input.today,
    trainingFrom: input.trainingFrom,
    recordStart: input.recordStart,
    confirmedFixedKeys: input.confirmedFixedKeys,
    detectedSubscriptions: input.detectedSubscriptions,
    budgetYen: input.budgetYen,
    payday: input.payday,
    bootstrapWeight: input.bootstrapWeight ?? 0,
    trials: input.trials ?? DEFAULT_TRIALS,
    seed: `${periodId}:${input.dataVersion}`,
    scope: input.scope,
    categoryTargets: input.categoryTargets,
  });

  const forecast = simulateForecast(simulateInput);
  const periodMonth = splitDateOnly(input.period.from)[1];
  const withCommitted: Forecast = {
    ...forecast,
    committed: {
      scheduledYen: decomposed.committed.scheduledYen,
      fixedYen: decomposed.committed.fixedYen,
    },
    seasonal: {
      active: forecast.seasonal.active,
      periodFactor: forecast.seasonal.active
        ? (simulateInput.fitted.monthFactor[periodMonth] ?? 1)
        : null,
    },
  };

  if (!input.calibration || input.calibration.widthFactor === 1) {
    return { ...withCommitted, calibration: input.calibration ?? null };
  }

  const factor = input.calibration.widthFactor;
  const total = widen(withCommitted.total, factor);
  return {
    ...withCommitted,
    total: { ...withCommitted.total, ...total },
    byCategory: withCommitted.byCategory.map((c) => ({
      ...c,
      ...applyWidthFactor(c, factor),
      landing: widen(c.landing, factor),
    })),
    calibration: input.calibration,
  };
}

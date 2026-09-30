/**
 * M1〜M3をつなぐ入口。呼び出し側(features/forecast/store.ts)は明細を渡すだけで
 * よく、分解・モデル推定・シミュレーションの手順をここに閉じ込める。
 */

import { remainingDays as remainingDaysOf } from '@/domain/period';
import type { DetectedSubscription } from '@/domain/subscriptions';
import type { DateOnly } from '@/lib/date';
import { decomposeSpending, type ForecastSourceTransaction } from './decompose';
import { fitModel } from './model';
import { DEFAULT_TRIALS, simulateForecast } from './simulate';
import type { Forecast } from './types';

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
};

export function buildForecast(input: BuildForecastInput): Forecast {
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

  const forecast = simulateForecast({
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
  });

  return {
    ...forecast,
    committed: {
      scheduledYen: decomposed.committed.scheduledYen,
      fixedYen: decomposed.committed.fixedYen,
    },
  };
}

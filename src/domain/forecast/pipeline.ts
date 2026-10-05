/**
 * 分解 → モデル推定 → シミュレーション入力の組み立て。本番の予測(engine.ts)と
 * 過去の月での検証(backtest.ts)が、同じ手順で同じ入力を作るための1か所。
 * 検証が本番と違う手順だと、「検証で当たった」が本番の当たり率を表さなくなる。
 */

import { remainingDays as remainingDaysOf } from '@/domain/period';
import type { DetectedSubscription } from '@/domain/subscriptions';
import type { DateOnly } from '@/lib/date';
import { decomposeSpending, type ForecastSourceTransaction } from './decompose';
import { fitModel } from './model';
import type { CategoryTarget, SimulateInput } from './simulate';
import type { DecomposedSpending, FittedModel } from './types';

/** 予測に数える範囲。目標のジャンルだけ・特別費を除く、などに絞る。 */
export type ForecastScope = {
  /** 指定すると、このジャンルの明細だけを数える(未分類は含めない)。 */
  genreIds?: ReadonlySet<string>;
  /** 特別費(kind='special')を数えない。目標のペースに混ぜない扱いに合わせる。 */
  excludeSpecial?: boolean;
};

export type PipelineInput = {
  transactions: readonly ForecastSourceTransaction[];
  period: { from: DateOnly; to: DateOnly };
  today: DateOnly;
  trainingFrom: DateOnly;
  recordStart: DateOnly | null;
  confirmedFixedKeys: ReadonlySet<string>;
  detectedSubscriptions: readonly DetectedSubscription[];
  budgetYen: number | null;
  payday: number | null;
  bootstrapWeight: number;
  trials?: number | undefined;
  seed: string;
  scope?: ForecastScope | undefined;
  categoryTargets?: readonly CategoryTarget[] | undefined;
  /** 残りの支出に掛ける中心の補正係数(検証で求めたもの)。 */
  remainingScale?: number | undefined;
  /** 直近を重く見る重みの半減期(日)。 */
  halfLifeDays?: number | undefined;
  /** 「予測を止める」にしたジャンル(残りの変動費を予測しない)。 */
  noForecastGenreIds?: ReadonlySet<string> | undefined;
};

export type Prepared = {
  decomposed: DecomposedSpending;
  fitted: FittedModel;
  simulateInput: SimulateInput;
};

export function applyScope(
  transactions: readonly ForecastSourceTransaction[],
  scope: ForecastScope | undefined,
): readonly ForecastSourceTransaction[] {
  if (scope === undefined) return transactions;
  return transactions.filter((t) => {
    if (scope.excludeSpecial && t.kind === 'special') return false;
    if (scope.genreIds !== undefined && (t.genreId === null || !scope.genreIds.has(t.genreId))) {
      return false;
    }
    return true;
  });
}

export function prepareSimulation(input: PipelineInput): Prepared {
  const decomposed = decomposeSpending({
    transactions: applyScope(input.transactions, input.scope),
    period: input.period,
    today: input.today,
    trainingFrom: input.trainingFrom,
    recordStart: input.recordStart,
    confirmedFixedKeys: input.confirmedFixedKeys,
    detectedSubscriptions: input.detectedSubscriptions,
    noForecastGenreIds: input.noForecastGenreIds,
  });
  const fitted = fitModel({
    variable: decomposed.variable,
    today: input.today,
    payday: input.payday,
    ...(input.halfLifeDays !== undefined ? { halfLifeDays: input.halfLifeDays } : {}),
  });
  const periodId = `${input.period.from}_${input.period.to}`;
  const simulateInput: SimulateInput = {
    periodId,
    today: input.today,
    periodTo: input.period.to,
    remainingDays: remainingDaysOf(input.period.from, input.period.to, input.today),
    fitted,
    committedYen: decomposed.committed.scheduledYen + decomposed.committed.fixedYen,
    actualYen: decomposed.actualYen,
    specialHistoricalAmounts: decomposed.special.historicalAmounts,
    specialOccurrencesPerDay: decomposed.special.occurrencesPerDay,
    budgetYen: input.budgetYen,
    payday: input.payday,
    bootstrapWeight: input.bootstrapWeight,
    ...(input.trials !== undefined ? { trials: input.trials } : {}),
    seed: input.seed,
    baseByCategory: decomposed.baseByCategory,
    visits: decomposed.visits,
    regularMerchants: decomposed.regularMerchants,
    ...(input.categoryTargets !== undefined ? { categoryTargets: input.categoryTargets } : {}),
    ...(input.remainingScale !== undefined ? { remainingScale: input.remainingScale } : {}),
  };
  return { decomposed, fitted, simulateInput };
}

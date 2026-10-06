/**
 * 分解 → モデル推定 → シミュレーション入力の組み立て。本番の予測(engine.ts)と
 * 過去の月での検証(backtest.ts)が、同じ手順で同じ入力を作るための1か所。
 * 検証が本番と違う手順だと、「検証で当たった」が本番の当たり率を表さなくなる。
 */

import { remainingDays as remainingDaysOf } from '@/domain/period';
import type { DetectedSubscription } from '@/domain/subscriptions';
import type { DateOnly } from '@/lib/date';
import { decomposeSpending, type ForecastSourceTransaction } from './decompose';
import { DEFAULT_MONTH_LEVEL_K, fitModel } from './model';
import type { PitCalibration } from './pit';
import type { CategoryTarget, SimulateInput } from './simulate';
import type { DecomposedSpending, FittedModel } from './types';

/** 予測に数える範囲。目標のジャンルだけ・特別費を除く、などに絞る。 */
export type ForecastScope = {
  /** 指定すると、このジャンルの明細だけを数える(未分類は含めない)。 */
  genreIds?: ReadonlySet<string>;
  /** 特別費(kind='special')を数えない。目標のペースに混ぜない扱いに合わせる。 */
  excludeSpecial?: boolean;
};

export type DecomposeInput = {
  transactions: readonly ForecastSourceTransaction[];
  period: { from: DateOnly; to: DateOnly };
  today: DateOnly;
  trainingFrom: DateOnly;
  recordStart: DateOnly | null;
  confirmedFixedKeys: ReadonlySet<string>;
  detectedSubscriptions: readonly DetectedSubscription[];
  scope?: ForecastScope | undefined;
  /** 「予測を止める」にしたジャンル(残りの変動費を予測しない)。 */
  noForecastGenreIds?: ReadonlySet<string> | undefined;
  /** 今月の水準の強さ k。Infinity なら期間の記録も学習に入れる(今月の水準を見ない)。 */
  monthLevelK?: number | undefined;
};

export type ModelInput = {
  budgetYen: number | null;
  payday: number | null;
  trials?: number | undefined;
  seed: string;
  categoryTargets?: readonly CategoryTarget[] | undefined;
  /** 残りの支出に掛ける中心の補正係数(検証で求めた、今の時点帯のもの)。 */
  remainingScale?: number | undefined;
  /** 直近を重く見る重みの半減期(日)。 */
  halfLifeDays?: number | undefined;
  calibration?: PitCalibration | null | undefined;
  mode?: 'paths' | 'totals' | undefined;
};

export type PipelineInput = DecomposeInput & ModelInput;

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

export function decomposeFor(input: DecomposeInput): DecomposedSpending {
  return decomposeSpending({
    transactions: applyScope(input.transactions, input.scope),
    period: input.period,
    today: input.today,
    trainingFrom: input.trainingFrom,
    recordStart: input.recordStart,
    confirmedFixedKeys: input.confirmedFixedKeys,
    detectedSubscriptions: input.detectedSubscriptions,
    noForecastGenreIds: input.noForecastGenreIds,
    separatePeriod: Number.isFinite(input.monthLevelK ?? DEFAULT_MONTH_LEVEL_K),
  });
}

export function fitFor(
  decomposed: DecomposedSpending,
  payday: number | null,
  halfLifeDays: number | undefined,
): FittedModel {
  return fitModel({
    variable: decomposed.variable,
    today: decomposed.today,
    payday,
    entryLag: decomposed.entryLag,
    ...(halfLifeDays !== undefined ? { halfLifeDays } : {}),
  });
}

export function simulateInputFor(
  decomposed: DecomposedSpending,
  fitted: FittedModel,
  input: ModelInput & { monthLevelK?: number | undefined },
): SimulateInput {
  const { period, today } = decomposed;
  return {
    periodId: `${period.from}_${period.to}`,
    today,
    periodFrom: period.from,
    periodTo: period.to,
    remainingDays: remainingDaysOf(period.from, period.to, today),
    fitted,
    payday: input.payday,
    actualYen: decomposed.actualYen,
    events: decomposed.committed.events,
    specialHistoricalAmounts: decomposed.special.historicalAmounts,
    specialOccurrencesPerDay: decomposed.special.occurrencesPerDay,
    budgetYen: input.budgetYen,
    ...(input.trials !== undefined ? { trials: input.trials } : {}),
    seed: input.seed,
    baseByCategory: decomposed.baseByCategory,
    visits: decomposed.visits,
    regularMerchants: decomposed.regularMerchants,
    billEvents: decomposed.billEvents,
    bills: decomposed.bills,
    periodObservations: decomposed.periodObservations,
    elapsedDates: decomposed.elapsedDates,
    entryLag: decomposed.entryLag,
    monthLevelK: input.monthLevelK ?? DEFAULT_MONTH_LEVEL_K,
    // 期間の記録を学習に入れたとき(分けなかったとき)は、今月の水準の更新で二重に数えない。
    levelUpdate: decomposed.separatedPeriod,
    ...(input.categoryTargets !== undefined ? { categoryTargets: input.categoryTargets } : {}),
    ...(input.remainingScale !== undefined ? { remainingScale: input.remainingScale } : {}),
    calibration: input.calibration ?? null,
    mode: input.mode ?? 'paths',
    categoryTypes: decomposed.categoryTypes,
  };
}

export function prepareSimulation(input: PipelineInput): Prepared {
  const decomposed = decomposeFor(input);
  const fitted = fitFor(decomposed, input.payday, input.halfLifeDays);
  return { decomposed, fitted, simulateInput: simulateInputFor(decomposed, fitted, input) };
}

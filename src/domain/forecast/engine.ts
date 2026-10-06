/**
 * 予測の入口。呼び出し側は明細を渡すだけでよく、分解・モデル推定・シミュレーション・
 * 補正の手順はここ(と pipeline.ts)に閉じ込める。レポート・目標の着地・カテゴリの画面・
 * 家計簿のグラフは、すべてこの1本の予測から出す(予測の仕組みを画面ごとに持たない)。
 */

import { daysBetween, splitDateOnly, type DateOnly } from '@/lib/date';
import { periodDays } from '@/domain/period';
import type { DetectedSubscription } from '@/domain/subscriptions';
import type { ForecastSourceTransaction } from './decompose';
import { prepareSimulation, type ForecastScope } from './pipeline';
import { daySpentShareAt } from './calendar';
import { CENTER_PRIOR_MONTHS } from './pit';
import { populationPriorFor, type PopulationPrior } from './population-prior';

const NO_PRIOR: PopulationPrior = {
  centerByPhase: { early: 1, mid: 1, late: 1 },
  pitByPhase: { early: [], mid: [], late: [] },
};
import {
  DEFAULT_TRIALS,
  simulateForecast,
  type CategoryTarget,
  type ForecastPromise,
} from './simulate';
import type { Forecast, ForecastCalibration, ForecastPhase } from './types';

/** 検証できた完了月がこれより少なければ、数字は「目安」。 */
export const PROVISIONAL_UNDER_MONTHS = 3;

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
  trials?: number;
  /** 過去の月での検証で求めた補正(features/forecast/calibration.ts)。無ければ補正なし。 */
  calibration?: ForecastCalibration | null;
  /** 直近を重く見る重みの半減期(日)。検証で選んだ値。 */
  halfLifeDays?: number;
  /** 今月の水準の強さ k。検証で選んだ値。 */
  monthLevelK?: number;
  /** ジャンルごとの今月の水準の強さ k_g(設計書 v3 4.2)。検証で選んだ値。 */
  genreLevelK?: number;
  /** 「予測を止める」にしたジャンル。残りの変動費を予測しない(実績・予定は数える)。 */
  noForecastGenreIds?: ReadonlySet<string>;
  /** 数える範囲(目標のジャンルだけ・特別費を除く、など)。 */
  scope?: ForecastScope;
  /** 目標額のあるカテゴリ。ジャンルごとに「目標を超える確率」を出す。 */
  categoryTargets?: readonly CategoryTarget[];
  /**
   * 今の時刻(設計書 v3 4.9)。渡すと、今日の残りの時間に使う見込みを足す(朝なら多め、夜なら少なめ)。
   * 渡さなければ(検証・評価)、今日は終わったものとして扱う。
   */
  now?: Date;
  /** 母集団の補正を使うか(既定は使う)。母集団の補正そのものを作るときだけ false。 */
  usePopulationPrior?: boolean;
  /** 期間の収入(手取りの設定、または直近の給料の中央値 + 予定の収入)。収支を出す。 */
  income?: { yen: number; source: 'setting' | 'salary' } | null;
  /** 本人が決めた約束(「外食を週1回へらす」)。今日の月の終わりまで見込みに入れる。 */
  promises?: readonly ForecastPromise[];
};

/** 期間のどの時点帯か(序盤:3分の1まで、中盤:3分の2まで、終盤)。 */
export function phaseOf(period: { from: DateOnly; to: DateOnly }, today: DateOnly): ForecastPhase {
  const total = periodDays(period.from, period.to);
  const elapsed = Math.min(total, Math.max(0, daysBetween(period.from, today) + 1));
  const fraction = total > 0 ? elapsed / total : 0;
  if (fraction <= 1 / 3) return 'early';
  if (fraction <= 2 / 3) return 'mid';
  return 'late';
}

export function buildForecast(input: BuildForecastInput): Forecast {
  const periodId = `${input.period.from}_${input.period.to}`;
  const phase = phaseOf(input.period, input.today);
  const calibration = input.calibration ?? null;
  // 母集団の補正(設計書 v3 4.5):本人の月が少ない分だけ、中心と PIT を母集団の値へ寄せる。
  const recordDays =
    input.recordStart === null ? 0 : Math.max(0, daysBetween(input.recordStart, input.today) + 1);
  const prior = input.usePopulationPrior === false ? NO_PRIOR : populationPriorFor(recordDays);
  const months = calibration?.months ?? 0;
  const ownCenterWeight = months / (months + CENTER_PRIOR_MONTHS);
  const center =
    (calibration?.centerByPhase[phase] ?? 1) +
    (1 - ownCenterWeight) * (prior.centerByPhase[phase] - 1);
  const pitPrior = prior.pitByPhase[phase];
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
    trials: input.trials ?? DEFAULT_TRIALS,
    seed: `${periodId}:${input.dataVersion}`,
    scope: input.scope,
    categoryTargets: input.categoryTargets,
    remainingScale: center,
    calibration: {
      pit: calibration?.pitByPhase[phase] ?? [],
      pitWeight: calibration?.pitWeight ?? 0,
      prior: pitPrior,
    },
    halfLifeDays: input.halfLifeDays,
    monthLevelK: input.monthLevelK,
    genreLevelK: input.genreLevelK,
    todayElapsedShare: input.now ? daySpentShareAt(input.now) : undefined,
    noForecastGenreIds: input.noForecastGenreIds,
    promises: input.promises,
    mode: 'paths',
  });

  const forecast = simulateForecast(simulateInput);
  const committedYen = decomposed.committed.scheduledYen + decomposed.committed.fixedYen;
  const remainingYen = Math.max(0, forecast.total.p50 - decomposed.actualYen - committedYen);
  const periodMonth = splitDateOnly(input.period.from)[1];
  const income = input.income ?? null;
  // 期ごと・年ごとの支払いのうち、残りの期間に来るものも、請求の内訳として見せる。
  const periodicItems = decomposed.periodic
    .filter((p) => decomposed.billEvents.some((e) => e.key === p.key))
    .map((p) => ({ label: `${p.label}(${p.periodLabel})`, meanYen: p.meanYen }));
  return {
    ...forecast,
    bills: { ...forecast.bills, items: [...forecast.bills.items, ...periodicItems] },
    committed: {
      scheduledYen: decomposed.committed.scheduledYen,
      fixedYen: decomposed.committed.fixedYen,
    },
    pace: {
      remainingYen,
      perDayYen:
        forecast.remainingDays > 0 ? Math.round(remainingYen / forecast.remainingDays) : null,
      recentPerDayYen:
        decomposed.recentPerDayYen === null ? null : Math.round(decomposed.recentPerDayYen),
    },
    seasonal: {
      active: forecast.seasonal.active,
      periodFactor: forecast.seasonal.active
        ? (simulateInput.fitted.monthFactor[periodMonth] ?? 1)
        : null,
    },
    phase,
    calibration,
    provisional: calibration === null || calibration.months < PROVISIONAL_UNDER_MONTHS,
    balance:
      income === null
        ? null
        : {
            incomeYen: income.yen,
            source: income.source,
            p10: income.yen - forecast.total.p90,
            p50: income.yen - forecast.total.p50,
            p90: income.yen - forecast.total.p10,
          },
  };
}

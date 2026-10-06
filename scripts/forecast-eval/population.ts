/**
 * 母集団の補正(設計書 v3 4.5)を合成データから作り、src/domain/forecast/population-prior-data.ts に
 * 書き出す。評価(run.ts)に使う世帯 0〜3 とは別の世帯 4〜7(同じ人物像、別の乱数)を使う。
 * 補正をかけない予測が、時点帯ごとに実際とどうずれたか(中心の比と、u の分布)を測る。
 *
 * 実行: npx tsx scripts/forecast-eval/population.ts
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { actualTotalForPeriod, knownTransactionsAt } from '../../src/domain/forecast/backtest';
import { buildForecast } from '../../src/domain/forecast/engine';
import { continuousRecordStart } from '../../src/domain/forecast/record';
import { TOTAL_QUANTILE_LEVELS } from '../../src/domain/forecast/simulate';
import type { ForecastPhase } from '../../src/domain/forecast/types';
import { recordLengthOf } from '../../src/domain/forecast/population-prior';
import { periodDays } from '../../src/domain/period';
import { addDays, daysBetween } from '../../src/lib/date';
import { pitOf } from './harness';
import { evalScenarios, PAYDAY } from './scenarios';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../src/domain/forecast/population-prior-data.ts');
const STEP = Number(process.env.EVAL_STEP ?? 3);
const PHASES: ForecastPhase[] = ['early', 'mid', 'late'];

type Obs = { phase: ForecastPhase; actual: number; known: number; quantiles: readonly number[] };
const buckets = { short: [] as Obs[], medium: [] as Obs[], long: [] as Obs[] };

const scenarios = evalScenarios(8).filter((s) => Number(s.name.split('#')[1]![0]) >= 4);
for (const scenario of scenarios) {
  for (const period of scenario.months) {
    const actual = actualTotalForPeriod(scenario.transactions, period);
    const days = periodDays(period.from, period.to);
    for (let elapsed = 2; elapsed <= days - 1; elapsed += STEP) {
      const asOf = addDays(period.from, elapsed - 1);
      const known = knownTransactionsAt(scenario.transactions, asOf);
      const recordStart = continuousRecordStart(known, asOf);
      const f = buildForecast({
        transactions: known,
        period,
        today: asOf,
        trainingFrom: addDays(asOf, -730),
        recordStart,
        confirmedFixedKeys: new Set(),
        detectedSubscriptions: [],
        budgetYen: null,
        payday: PAYDAY,
        dataVersion: 'population',
        trials: 2000,
        usePopulationPrior: false,
      });
      const recordDays = recordStart === null ? 0 : daysBetween(recordStart, asOf) + 1;
      const fraction = elapsed / days;
      const phase: ForecastPhase = fraction <= 1 / 3 ? 'early' : fraction <= 2 / 3 ? 'mid' : 'late';
      buckets[recordLengthOf(recordDays)].push({
        phase,
        actual,
        known: f.actualYen + f.committed.scheduledYen + f.committed.fixedYen,
        quantiles: f.totalQuantiles,
      });
    }
    console.log(`${scenario.name} ${period.from}`);
  }
}

/** 中心の比:Σ(実際 − 決まっている額) ÷ Σ(中央 − 決まっている額)。 */
function centerOf(list: readonly Obs[]): number {
  let a = 0;
  let p = 0;
  for (const o of list) {
    const median = o.quantiles[9]!;
    if (median - o.known <= 0) continue;
    a += Math.max(0, o.actual - o.known);
    p += median - o.known;
  }
  return p > 0 ? Math.min(1.6, Math.max(0.7, a / p)) : 1;
}

/** 中心をそろえたあとの u の分位点(0, 5%, …, 100% の21点)。 */
function pitPointsOf(list: readonly Obs[], center: number): number[] {
  const us = list
    .map((o) =>
      pitOf(
        o.quantiles.map((q) => o.known + (q - o.known) * center),
        TOTAL_QUANTILE_LEVELS,
        o.actual,
      ),
    )
    .sort((a, b) => a - b);
  if (us.length === 0) return [];
  return Array.from({ length: 21 }, (_, i) => {
    const idx = Math.min(us.length - 1, Math.round((i / 20) * (us.length - 1)));
    return Math.round(us[idx]! * 1000) / 1000;
  });
}

function priorOf(list: readonly Obs[]) {
  const centerByPhase = Object.fromEntries(
    PHASES.map((ph) => [
      ph,
      Math.round(centerOf(list.filter((o) => o.phase === ph)) * 1000) / 1000,
    ]),
  ) as Record<ForecastPhase, number>;
  const pitByPhase = Object.fromEntries(
    PHASES.map((ph) => [
      ph,
      pitPointsOf(
        list.filter((o) => o.phase === ph),
        centerByPhase[ph],
      ),
    ]),
  ) as Record<ForecastPhase, number[]>;
  return { centerByPhase, pitByPhase, count: list.length };
}

const short = priorOf(buckets.short);
const medium = priorOf(buckets.medium);
const long = priorOf(buckets.long);
const fmt = (p: ReturnType<typeof priorOf>) =>
  `{\n    // 時点の数: ${p.count}\n    centerByPhase: ${JSON.stringify(p.centerByPhase)},\n    pitByPhase: ${JSON.stringify(p.pitByPhase)},\n  }`;
writeFileSync(
  OUT,
  `/**
 * 自動生成:scripts/forecast-eval/population.ts。手で編集しないこと。
 * 合成データ(評価に使わない世帯 4〜7)で、補正をかけない予測が実際とどうずれたか。
 */

import type { PopulationPrior } from './population-prior';

export const POPULATION_PRIOR_DATA: Record<'short' | 'medium' | 'long', PopulationPrior> = {
  short: ${fmt(short)},
  medium: ${fmt(medium)},
  long: ${fmt(long)},
};
`,
  'utf8',
);
console.log(
  JSON.stringify({
    short: short.centerByPhase,
    medium: medium.centerByPhase,
    long: long.centerByPhase,
  }),
);
console.log(`書き出しました: ${OUT}`);

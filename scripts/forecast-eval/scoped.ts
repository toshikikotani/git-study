/**
 * 範囲を限定した目標の時系列評価(合成世帯0、2か月 × 2カテゴリ × 3時点 = 12予測)。
 * 同じ現エンジンで、全体の補正の流用と、範囲をそろえた補正を比べる。係数の調整には使わない。
 * 実行: node --import tsx scripts/forecast-eval/scoped.ts
 * 生結果は EVAL_SCOPE_OUT、未指定なら一時ディレクトリへ書く。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { actualTotalForPeriod, knownTransactionsAt } from '../../src/domain/forecast/backtest';
import { buildForecast } from '../../src/domain/forecast/engine';
import { applyScope } from '../../src/domain/forecast/pipeline';
import { continuousRecordStart } from '../../src/domain/forecast/record';
import { verifyForecast, type Verification } from '../../src/features/forecast/calibration';
import { addDays } from '../../src/lib/date';
import { quantileCrps, QUANTILE_LEVELS } from './harness';
import { lastMonths, PAYDAY, richTransactions } from './scenarios';

type Outcome = {
  p10: number;
  p50: number;
  p90: number;
  crps: number;
  hit: boolean;
  absError: number;
};
type Observation = {
  genreId: string;
  period: string;
  today: string;
  actual: number;
  globalCalibration: Outcome;
  scopedCalibration: Outcome;
};

const transactions = richTransactions(0);
const rows: Observation[] = [];
for (const period of lastMonths(2)) {
  // 補正の学習は各月の初日に既知だった、完了した月だけ。対象月の結果を混ぜない。
  const atStart = knownTransactionsAt(transactions, period.from);
  const completed = atStart.filter((t) => t.occurredOn < period.from);
  const recordStart = continuousRecordStart(atStart, period.from);
  const common = { transactions: completed, today: period.from, recordStart, payday: PAYDAY };
  const global = verifyForecast({ ...common, cacheKey: `heldout:global:${period.from}` });
  for (const genreId of ['dining', 'grocery']) {
    const scope = { genreIds: new Set([genreId]), excludeSpecial: true };
    const scoped = verifyForecast({
      ...common,
      scope,
      cacheKey: `heldout:scoped:${period.from}:${genreId}`,
    });
    const actual = actualTotalForPeriod(applyScope(transactions, scope), period);
    for (const day of [2, 12, 22]) {
      const today = addDays(period.from, day - 1);
      const known = knownTransactionsAt(transactions, today);
      const predict = (verification: Verification | null, usePopulationPrior: boolean): Outcome => {
        const f = buildForecast({
          transactions: known,
          period,
          today,
          trainingFrom: addDays(today, -730),
          recordStart: continuousRecordStart(known, today),
          confirmedFixedKeys: new Set(),
          detectedSubscriptions: [],
          budgetYen: null,
          payday: PAYDAY,
          scope,
          dataVersion: 'scoped-heldout',
          trials: 2000,
          calibration: verification?.calibration ?? null,
          ...(verification
            ? {
                halfLifeDays: verification.halfLifeDays,
                monthLevelK: verification.monthLevelK ?? Infinity,
                genreLevelK: verification.genreLevelK ?? Infinity,
              }
            : {}),
          usePopulationPrior,
        });
        return {
          p10: f.total.p10,
          p50: f.total.p50,
          p90: f.total.p90,
          crps: quantileCrps(f.totalQuantiles, QUANTILE_LEVELS, actual),
          hit: actual >= f.total.p10 && actual <= f.total.p90,
          absError: Math.abs(f.total.p50 - actual),
        };
      };
      // 両方とも同じ試行数・種・明細を使う。違うのは校正と母集団補正の流用だけ。
      rows.push({
        genreId,
        period: period.from,
        today,
        actual,
        globalCalibration: predict(global, true),
        scopedCalibration: predict(scoped, false),
      });
    }
  }
}

const out = process.env.EVAL_SCOPE_OUT ?? join(tmpdir(), 'forecast-eval-scoped.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
for (const genreId of ['all', 'dining', 'grocery']) {
  const selected = rows.filter((r) => genreId === 'all' || r.genreId === genreId);
  for (const method of ['globalCalibration', 'scopedCalibration'] as const) {
    const metrics = selected.map((r) => r[method]);
    console.log(
      JSON.stringify({
        genreId,
        method,
        count: metrics.length,
        crps: metrics.reduce((s, r) => s + r.crps, 0) / metrics.length,
        coverage80: metrics.filter((r) => r.hit).length / metrics.length,
        mae: metrics.reduce((s, r) => s + r.absError, 0) / metrics.length,
      }),
    );
  }
}
console.log(`生結果: ${out}`);

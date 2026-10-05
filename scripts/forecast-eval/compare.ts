/**
 * 予測方式の比較(合成データ)。同じデータ・同じ月・同じ時点で、設定ごとの
 * 的中率(80%の幅)・中央値の誤差・CRPS を並べる。
 * 実行: npx tsx scripts/forecast-eval/compare.ts
 */

import { runBacktest } from '../../src/domain/forecast/backtest';
import { FROM, lastMonths, PAYDAY, richTransactions } from './scenarios';

const transactions = richTransactions();
const periods = lastMonths(8);
const TRIALS = 1500;

const configs: { name: string; trainingWindowDays: number; payday: number | null; w: number }[] = [
  { name: '窓90日・給料日なし・ベイズ', trainingWindowDays: 90, payday: null, w: 0 },
  { name: '窓90日・給料日あり・ベイズ', trainingWindowDays: 90, payday: PAYDAY, w: 0 },
  { name: '窓400日・給料日あり・ベイズ', trainingWindowDays: 400, payday: PAYDAY, w: 0 },
  { name: '窓400日・給料日あり・アンサンブル', trainingWindowDays: 400, payday: PAYDAY, w: 0.5 },
  { name: '窓730日・給料日あり・ベイズ', trainingWindowDays: 730, payday: PAYDAY, w: 0 },
  { name: '窓730日・給料日あり・アンサンブル', trainingWindowDays: 730, payday: PAYDAY, w: 0.5 },
];

for (const c of configs) {
  const result = runBacktest({
    transactions,
    periods,
    trainingWindowDays: c.trainingWindowDays,
    recordStart: FROM,
    payday: c.payday,
    bootstrapWeight: c.w,
    trials: TRIALS,
  });
  console.log(
    `${c.name}: 件数${result.points.length} 的中率${(result.hitRate80 * 100).toFixed(1)}% ` +
      `p50誤差${(result.medianAbsErrorRatio * 100).toFixed(1)}% CRPS${Math.round(result.meanCrps)}`,
  );
}

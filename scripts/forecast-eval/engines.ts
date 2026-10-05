/** 評価で使う v2 エンジン(本番と同じ:検証 → 補正 → 予測)。 */

import { buildForecast } from '../../src/domain/forecast/engine';
import { continuousRecordStart } from '../../src/domain/forecast/record';
import { addDays } from '../../src/lib/date';
import { verifyForecast, type Verification } from '../../src/features/forecast/calibration';
import type { EvalEngine } from './harness';

let counter = 0;

export const v2Engine: EvalEngine<Verification | null> = {
  verify({ completed, today, payday }) {
    counter += 1;
    return verifyForecast({
      cacheKey: `eval:${counter}`,
      transactions: completed,
      today,
      recordStart: continuousRecordStart(completed, today),
      payday,
    });
  },
  forecast({ known, period, today, payday, state }) {
    const f = buildForecast({
      transactions: known,
      period,
      today,
      trainingFrom: addDays(today, -730),
      recordStart: continuousRecordStart(known, today),
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
      budgetYen: null,
      payday,
      dataVersion: 'eval',
      trials: 2000,
      // 調べるとき用:EVAL_NO_CAL=1 で補正なし、EVAL_K=3 などで k を固定して測る。
      calibration: process.env.EVAL_NO_CAL ? null : (state?.calibration ?? null),
      ...(state
        ? { halfLifeDays: state.halfLifeDays, monthLevelK: state.monthLevelK ?? Infinity }
        : {}),
      ...(process.env.EVAL_K ? { monthLevelK: Number(process.env.EVAL_K) } : {}),
    });
    return { p10: f.total.p10, p50: f.total.p50, p90: f.total.p90 };
  },
};

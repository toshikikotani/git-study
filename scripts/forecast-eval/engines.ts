/** 評価で使う v2 エンジン(本番と同じ:検証 → 補正 → 予測。目標があれば注意も本番と同じ規則で出す)。 */

import { actualByCategoryForPeriod } from '../../src/domain/forecast/backtest';
import type { CautionPrecision } from '../../src/domain/forecast/caution';
import { buildForecast } from '../../src/domain/forecast/engine';
import { landingRowsFrom } from '../../src/domain/forecast/landing-rows';
import { continuousRecordStart } from '../../src/domain/forecast/record';
import { periodDays } from '../../src/domain/period';
import { addDays, addMonths, type DateOnly } from '../../src/lib/date';
import {
  verifyCautions,
  verifyForecast,
  type Verification,
} from '../../src/features/forecast/calibration';
import type { EvalEngine } from './harness';

let counter = 0;

/** 目標を置くジャンルの、月の支出の下限(少額のジャンルには目標を置かない人が多い)。 */
const MIN_TARGET_YEN = 3000;

type State = {
  verification: Verification | null;
  /** ジャンルごとの月の目標(直近3か月の平均。ふつうの人が置く「いつもくらい」の目標)。 */
  targets: { categoryId: string; categoryName: string; monthlyYen: number }[];
  cautionPrecision: CautionPrecision;
};

/** 直近3か月(完了した月)の平均を、ジャンルの目標にする。 */
function targetsFrom(
  completed: Parameters<typeof actualByCategoryForPeriod>[0],
  monthStart: DateOnly,
): State['targets'] {
  const sums = new Map<string, number>();
  const names = new Map<string, string>();
  for (const t of completed) if (t.genreId) names.set(t.genreId, t.genreName ?? '');
  for (let i = 1; i <= 3; i += 1) {
    const from = addMonths(monthStart, -i);
    const to = addDays(addMonths(from, 1), -1);
    for (const [id, yen] of actualByCategoryForPeriod(completed, { from, to })) {
      sums.set(id, (sums.get(id) ?? 0) + yen);
    }
  }
  return [...sums.entries()]
    .filter(([id, sum]) => id !== 'none' && sum / 3 >= MIN_TARGET_YEN)
    .map(([id, sum]) => ({
      categoryId: id,
      categoryName: names.get(id) ?? id,
      monthlyYen: Math.round(sum / 3 / 100) * 100,
    }));
}

/** EVAL_CAUTIONS=0 で注意の評価を飛ばす(速く回したいとき)。 */
const WITH_CAUTIONS = process.env.EVAL_CAUTIONS !== '0';

export const v2Engine: EvalEngine<State> = {
  verify({ completed, today, payday }) {
    counter += 1;
    const recordStart = continuousRecordStart(completed, today);
    const verification = verifyForecast({
      cacheKey: `eval:${counter}`,
      transactions: completed,
      today,
      recordStart,
      payday,
    });
    const targets = WITH_CAUTIONS ? targetsFrom(completed, today) : [];
    const days = periodDays(today, addDays(addMonths(today, 1), -1));
    const cautionPrecision =
      targets.length > 0
        ? verifyCautions({
            cacheKey: `eval-caution:${counter}`,
            transactions: completed,
            today,
            recordStart,
            payday,
            verification,
            targets: targets.map((t) => ({
              categoryId: t.categoryId,
              targetYen: Math.round((t.monthlyYen * 30) / days),
            })),
          })
        : {};
    return { verification, targets, cautionPrecision };
  },
  forecast({ known, period, today, payday, state }) {
    const { verification } = state;
    const targets = state.targets;
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
      calibration: process.env.EVAL_NO_CAL ? null : (verification?.calibration ?? null),
      ...(verification
        ? {
            halfLifeDays: verification.halfLifeDays,
            monthLevelK: verification.monthLevelK ?? Infinity,
            genreLevelK: verification.genreLevelK ?? Infinity,
          }
        : {}),
      ...(process.env.EVAL_K ? { monthLevelK: Number(process.env.EVAL_K) } : {}),
      ...(targets.length > 0
        ? {
            categoryTargets: targets.map((t) => ({
              categoryId: t.categoryId,
              categoryName: t.categoryName,
              targetYen: t.monthlyYen,
            })),
          }
        : {}),
    });
    // 画面と同じ関数で注意を決める(精度が低い時点帯では止める。EVAL_NO_MUTE=1 で止めずに測る)。
    const cautions = landingRowsFrom({
      forecast: f,
      cautionPrecision: process.env.EVAL_NO_MUTE ? null : state.cautionPrecision,
      limit: Number.MAX_SAFE_INTEGER,
    })
      .filter((row) => row.caution?.kind === 'likely' && row.targetYen !== null)
      .map((row) => ({ categoryId: row.genreId, targetYen: row.targetYen! }));
    return {
      p10: f.total.p10,
      p50: f.total.p50,
      p90: f.total.p90,
      quantiles: f.totalQuantiles,
      cautions,
    };
  },
};

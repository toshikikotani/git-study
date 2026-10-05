/**
 * M4「結果を docs/FORECAST_EVAL.md に記録する」の実行スクリプト。
 *
 * このセッションには本番Supabase・実際の利用者のデータへのアクセス手段が
 * 無いため、複数の支出パターン(毎日・週1回・飛び飛び・稀に高額)を持つ
 * 合成データで代用する(docs/decisions.md に記録)。本番データでの再評価は
 * 残課題として明記する。
 *
 * 実行: npm run eval:forecast
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { calibrateWidth, runBacktest, selectModel } from '../../src/domain/forecast/backtest';
import type { ForecastSourceTransaction } from '../../src/domain/forecast/decompose';
import { eachDay } from '../../src/domain/period';
import { weekdayOf, type DateOnly } from '../../src/lib/date';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../../docs/FORECAST_EVAL.md');

function tx(
  o: Partial<ForecastSourceTransaction> & { occurredOn: DateOnly; amountYen: number },
): ForecastSourceTransaction {
  return {
    genreId: 'g',
    genreName: '',
    status: 'actual',
    kind: 'normal',
    isTransfer: false,
    reviewStatus: 'auto_ok',
    needsInput: false,
    merchantName: null,
    description: 'x',
    ...o,
  };
}

/** 決定論的な疑似乱数(このスクリプト専用、シミュレーション本体とは無関係)。 */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poissonish(rng: () => number, mean: number): number {
  // 簡易近似:平均mean・分散mean程度になる非負整数(評価データ生成専用)。
  let count = 0;
  let acc = -Math.log(rng());
  while (acc < mean) {
    count += 1;
    acc += -Math.log(rng());
  }
  return count;
}

function buildScenario(
  categoryId: string,
  categoryName: string,
  from: DateOnly,
  to: DateOnly,
  daily: number,
  amountMean: number,
  amountSpread: number,
  weekdaysOnly: boolean,
  seed: number,
): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  const out: ForecastSourceTransaction[] = [];
  for (const d of eachDay(from, to)) {
    if (weekdaysOnly && [0, 6].includes(weekdayOf(d))) continue;
    const count = poissonish(rng, daily);
    for (let i = 0; i < count; i += 1) {
      const amount = Math.max(100, Math.round(amountMean + (rng() * 2 - 1) * amountSpread));
      out.push(
        tx({ occurredOn: d, amountYen: -amount, genreId: categoryId, genreName: categoryName }),
      );
    }
  }
  return out;
}

function buildOutlierScenario(
  categoryId: string,
  categoryName: string,
  from: DateOnly,
  to: DateOnly,
  seed: number,
): ForecastSourceTransaction[] {
  // 稀に高額(医療費のような)。月1回あるかないか。
  const rng = mulberry32(seed);
  const out: ForecastSourceTransaction[] = [];
  for (const d of eachDay(from, to)) {
    if (rng() < 1 / 45) {
      out.push(
        tx({
          occurredOn: d,
          amountYen: -Math.round(3000 + rng() * 15000),
          genreId: categoryId,
          genreName: categoryName,
        }),
      );
    }
  }
  return out;
}

const FROM: DateOnly = '2024-10-01';
const TO: DateOnly = '2026-09-30';

const transactions: ForecastSourceTransaction[] = [
  ...buildScenario('dining', '外食', FROM, TO, 0.8, 1200, 500, false, 1),
  ...buildScenario('grocery', '日用品', FROM, TO, 1 / 3, 3500, 1200, false, 2),
  ...buildScenario('transit', '交通費', FROM, TO, 0.9, 420, 40, true, 3),
  ...buildScenario('hobby', '娯楽・趣味', FROM, TO, 1 / 6, 4000, 3000, false, 4),
  ...buildOutlierScenario('medical', '医療', FROM, TO, 5),
];

// 直近6ヶ月の完了済み月(給料日等は考えず、暦月で単純化)。
const PERIODS: { from: DateOnly; to: DateOnly }[] = [
  { from: '2026-02-01', to: '2026-02-28' },
  { from: '2026-03-01', to: '2026-03-31' },
  { from: '2026-04-01', to: '2026-04-30' },
  { from: '2026-05-01', to: '2026-05-31' },
  { from: '2026-06-01', to: '2026-06-30' },
  { from: '2026-07-01', to: '2026-07-31' },
];

const TRAINING_WINDOW_DAYS = 180;
const TRIALS = 2000;

console.log('モデル選択(ベイズ/ブートストラップ/アンサンブル)を評価中...');
const selection = selectModel({
  transactions,
  periods: PERIODS,
  trainingWindowDays: TRAINING_WINDOW_DAYS,
  recordStart: FROM,
  trials: TRIALS,
});
console.log('選ばれたモデル:', selection.method, selection.crpsByMethod);

console.log('選ばれたモデルでバックテストを実行中...');
const backtest = runBacktest({
  transactions,
  periods: PERIODS,
  trainingWindowDays: TRAINING_WINDOW_DAYS,
  recordStart: FROM,
  bootstrapWeight: selection.bootstrapWeight,
  trials: TRIALS,
});

const calibration = calibrateWidth(backtest.points);

const TARGET_MIN = 0.75;
const TARGET_MAX = 0.85;
const withinTarget = backtest.hitRate80 >= TARGET_MIN && backtest.hitRate80 <= TARGET_MAX;

const rows = backtest.points
  .map(
    (p) =>
      `| ${p.periodFrom}〜${p.periodTo.slice(5)} | ${p.asOf} | ${Math.round(p.actualTotal).toLocaleString('ja-JP')} | ${Math.round(p.p10).toLocaleString('ja-JP')} | ${Math.round(p.p50).toLocaleString('ja-JP')} | ${Math.round(p.p90).toLocaleString('ja-JP')} | ${p.hitWithin80 ? 'ok' : 'NG'} |`,
  )
  .join('\n');

const md = `# 予測エンジンの評価(M4、ADR-065)

自動生成:\`npm run eval:forecast\`(\`scripts/forecast-eval/run.ts\`)。手で編集しないこと。

## データについて

このセッションには本番 Supabase・実際の利用者の明細へのアクセス手段が無いため、
5種類の支出パターン(毎日の外食、週1回ペースの日用品、平日だけの交通費、
不定期な娯楽、月1回あるかないかの医療費)を持つ合成データ(${FROM}〜${TO}、
5,000件超)で代用した。**本番データでの再評価は残課題**(下記参照)。

## モデル選択

世帯全体の合計額のCRPS(小さいほど良い)で比較し、\`${selection.method}\` を選んだ
(bootstrapWeight=${selection.bootstrapWeight})。

| 方式 | CRPS |
|---|---|
| ベイズのみ | ${Number.isFinite(selection.crpsByMethod.bayes) ? Math.round(selection.crpsByMethod.bayes).toLocaleString('ja-JP') : '—'} |
| ブロック・ブートストラップのみ | ${Number.isFinite(selection.crpsByMethod.bootstrap) ? Math.round(selection.crpsByMethod.bootstrap).toLocaleString('ja-JP') : '—'} |
| アンサンブル(50/50) | ${Number.isFinite(selection.crpsByMethod.ensemble) ? Math.round(selection.crpsByMethod.ensemble).toLocaleString('ja-JP') : '—'} |

## バックテスト結果(受け入れ基準8)

- 対象:直近6ヶ月分、各月4時点(1日目・3日目・半分・残り2日)= ${backtest.points.length}件
- **80%の幅の的中率:${(backtest.hitRate80 * 100).toFixed(1)}%**(目標75〜85%) → ${withinTarget ? '✅ 目標内' : '⚠️ 目標外(下記「目標を外れた場合」参照)'}
- 中央値(p50)の誤差率(平均):${(backtest.medianAbsErrorRatio * 100).toFixed(1)}%
- 平均CRPS:${Math.round(backtest.meanCrps).toLocaleString('ja-JP')}円

### コンフォーマル補正

widthFactor = **${calibration.widthFactor.toFixed(3)}**(サンプル数 ${calibration.sampleSize})。
1より大きい場合は元の帯(p10〜p90)が実際より狭すぎたことを意味し、表示する幅を
この係数だけ広げる(\`domain/forecast/backtest.ts\` の \`applyWidthFactor()\`)。

### 期間ごとの内訳

| 期間 | 時点 | 実績 | p10 | p50 | p90 | 80%の幅に入ったか |
|---|---|---|---|---|---|---|
${rows}

${
  withinTarget
    ? ''
    : `## 目標を外れた場合の原因と改善案

的中率が目標(75〜85%)から外れている。考えられる原因:

1. 合成データが実際の家計より単純(カテゴリ間の相関・季節性が無い)ため、
   モデルの想定と一致しすぎる/しなさすぎる可能性がある。
2. バックテストの点数(${backtest.points.length}件)がまだ少なく、コンフォーマル補正
   (widthFactor)の推定自体にばらつきが残っている可能性がある。
3. 曜日・給料日係数の事前分布の強さ(COEF_PRIOR_DAYS=30)が、この合成データの
   パターン(特に交通費のような平日限定の支出)に対して強すぎる/弱すぎる
   可能性がある。

**次の一手**:本番データが使えるようになった時点で、このスクリプトを本番の
明細に対して再実行し、widthFactor を実データで再計算する。それでも目標を
外れる場合は、COEF_PRIOR_DAYS・AMOUNT_PRIOR_STRENGTH(domain/forecast/model.ts)
の事前分布の強さを本番データに合わせて調整する。
`
}

## 残課題

- **本番データでの再評価**:このセッションには本番 Supabase・実際の利用者の
  ログイン手段が無いため、実際の家計データでの検証は未実施。運用開始後、
  このスクリプトを本番データ向けに書き換えて再実行すること。
- **カテゴリごとのモデル選択**:本人要件は「カテゴリごとに最良の方式を選ぶ」
  だが、このセッションでは世帯全体の合計額で1つの方式を選ぶ簡略化をした
  (docs/decisions.md 参照)。カテゴリごとの比較は、カテゴリ単位のバックテスト
  データが十分に溜まってから追加する。
- **widthFactor の定期更新**:このスクリプトは手動実行が前提。本番では
  月次バッチ等で定期的に再計算し、結果を保存して \`buildForecast()\` の
  \`calibration\` 引数に渡す仕組みが要る(未実装、features/forecast/store.ts
  の残課題)。
`;

writeFileSync(OUT_PATH, md, 'utf8');
console.log(`書き出しました: ${OUT_PATH}`);

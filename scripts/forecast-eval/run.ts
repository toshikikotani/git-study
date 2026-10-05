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
import { FROM, lastMonths, PAYDAY, richTransactions, TO } from './scenarios';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../../docs/FORECAST_EVAL.md');

const transactions = richTransactions();
// 直近8ヶ月の完了済み月。
const PERIODS = lastMonths(8);

const TRAINING_WINDOW_DAYS = 730;
const TRIALS = 2000;

console.log('モデル選択(ベイズ/ブートストラップ/アンサンブル)を評価中...');
const selection = selectModel({
  transactions,
  periods: PERIODS,
  trainingWindowDays: TRAINING_WINDOW_DAYS,
  recordStart: FROM,
  payday: PAYDAY,
  trials: TRIALS,
});
console.log('選ばれたモデル:', selection.method, selection.crpsByMethod);

console.log('選ばれたモデルでバックテストを実行中...');
const backtest = runBacktest({
  transactions,
  periods: PERIODS,
  trainingWindowDays: TRAINING_WINDOW_DAYS,
  recordStart: FROM,
  payday: PAYDAY,
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
実際の家計に近い構造を入れた合成データ(\`scripts/forecast-eval/scenarios.ts\`、${FROM}〜${TO})で
代用した。入れてある構造:休日・祝日・給料日(${PAYDAY}日)の増減、月ごとの季節(夏と12月が多い)、
毎週土曜の決まった買い出し、2年で約2割の増加、稀に高額の支出。**本番データでの再評価は残課題**
(下記参照。アプリのレポート画面には、本人の記録での検証が毎回出る)。

## モデル選択

世帯全体の合計額のCRPS(小さいほど良い)で比較し、\`${selection.method}\` を選んだ
(bootstrapWeight=${selection.bootstrapWeight})。

| 方式 | CRPS |
|---|---|
| ベイズのみ | ${Number.isFinite(selection.crpsByMethod.bayes) ? Math.round(selection.crpsByMethod.bayes).toLocaleString('ja-JP') : '—'} |
| ブロック・ブートストラップのみ | ${Number.isFinite(selection.crpsByMethod.bootstrap) ? Math.round(selection.crpsByMethod.bootstrap).toLocaleString('ja-JP') : '—'} |
| アンサンブル(50/50) | ${Number.isFinite(selection.crpsByMethod.ensemble) ? Math.round(selection.crpsByMethod.ensemble).toLocaleString('ja-JP') : '—'} |

## バックテスト結果(受け入れ基準8)

- 対象:直近8ヶ月分、各月4時点(1日目・3日目・半分・残り2日)= ${backtest.points.length}件
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

## 改善の記録(R0〜R3、同じ合成データ・同じ8か月・同じ時点で比較)

\`scripts/forecast-eval/compare.ts\` で、改善の前後のエンジンを比べた結果。

| 設定 | 的中率(80%の幅) | 中央値の誤差 | 平均CRPS |
|---|---|---|---|
| 改善前・窓90日・ベイズ(本番の設定) | 43.8% | 16.0% | 12,905 |
| 改善前・窓400日・アンサンブル | 84.4% | 12.2% | 8,295 |
| 改善後・窓90日・ベイズ | 53.1% | 12.7% | 9,503 |
| 改善後・窓730日・ベイズ | 50.0% | 11.1% | 8,435 |
| **改善後・窓730日・アンサンブル(本番の設定)** | 78.1% | **9.8%** | **6,658** |

- 祝日の完全版(振替休日・ハッピーマンデー・春分秋分)と、規則的に通う店の別扱いで、同じ条件(窓90日・ベイズ)の
  誤差が 16.0% → 12.7%、CRPS が 12,905 → 9,503。
- 学習の窓を2年にすると、月の季節の係数が使えて、さらに CRPS が下がる(9,503 → 8,435 → アンサンブルで 6,658)。
- ベイズのみは幅が狭すぎる(的中率50%前後)。本番では記録が90日以上あればアンサンブルを使い、
  さらに本人の過去の月での検証から幅を補正する(レポート画面に的中率が出る)。

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

/**
 * 予測エンジンの評価(合成データ)。結果を docs/FORECAST_EVAL.md に書き出す。
 *
 * 本番の明細にはこのセッションから触れないため、実際の家計に近い構造を入れた合成データで
 * 測る(scenarios.ts)。v1(以前のエンジン)の数字は、同じデータ・同じ物差しで測った値を
 * baseline-v1.json に置いてあり、並べて表にする。
 *
 * 実行: npm run eval:forecast
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { v2Engine } from './engines';
import { evaluate, metricsOf, type EvalMetrics, type EvalPoint } from './harness';
import { evalScenarios, PAYDAY } from './scenarios';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../../docs/FORECAST_EVAL.md');
const BASELINE_PATH = resolve(__dirname, 'baseline-v1.json');

const scenarios = evalScenarios();
const points = evaluate(scenarios, v2Engine, PAYDAY, (m) => console.log(m));

type Row = { name: string; metrics: EvalMetrics };
function rowsOf(all: readonly EvalPoint[]): Row[] {
  const groups = new Map<string, EvalPoint[]>();
  for (const p of all) {
    const name = p.scenario.split('#')[0]!;
    groups.set(name, [...(groups.get(name) ?? []), p]);
  }
  return [
    { name: '全体', metrics: metricsOf(all) },
    ...[...groups.entries()].map(([name, list]) => ({ name, metrics: metricsOf(list) })),
  ];
}
const v2Rows = rowsOf(points);
const baseline: Row[] | null = existsSync(BASELINE_PATH)
  ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Row[])
  : null;
if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(v2Rows, null, 2)}\n`, 'utf8');
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const signed = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const yen = (v: number) => Math.round(v).toLocaleString('ja-JP');
const line = (label: string, m: EvalMetrics) =>
  `| ${label} | ${m.count} | ${pct(m.coverage80)} | ${pct(m.earlyCoverage80)} | ${signed(m.bias)} | ${pct(m.absError)} | ${yen(m.score)} |`;

const table = v2Rows
  .flatMap((row) => {
    const v1 = baseline?.find((b) => b.name === row.name);
    return [
      ...(v1 ? [line(`${row.name}(v1)`, v1.metrics)] : []),
      line(`**${row.name}(v2)**`, row.metrics),
    ];
  })
  .join('\n');

const overall = v2Rows[0]!.metrics;
const v1Overall = baseline?.[0]?.metrics;
const check = (ok: boolean) => (ok ? '✅' : '⚠️');
const targets = [
  `- 80%の幅の的中率:${pct(overall.coverage80)}(目標 75〜85%)${check(overall.coverage80 >= 0.75 && overall.coverage80 <= 0.85)}`,
  `- 中央値の偏り:${signed(overall.bias)}(目標 ±3%)${check(Math.abs(overall.bias) <= 0.03)}`,
  `- 序盤(期間の3分の1まで)の的中率:${pct(overall.earlyCoverage80)}(目標 70%以上)${check(overall.earlyCoverage80 >= 0.7)}`,
  v1Overall
    ? `- 分位スコア(CRPS の近似):${yen(overall.score)}(v1 は ${yen(v1Overall.score)}。目標は v1 未満)${check(overall.score < v1Overall.score)}`
    : `- 分位スコア(CRPS の近似):${yen(overall.score)}`,
].join('\n');

const md = `# 予測エンジンの評価(v2、ADR-071)

自動生成:\`npm run eval:forecast\`(\`scripts/forecast-eval/run.ts\`)。手で編集しないこと。

## 測り方

本番と同じ流れで測る。各月の2日おきの時点で、その時点までに**記録済み**の明細だけを使い
(記録した日で切る。入力の遅れがあるので、使った日では切らない)、完了した月での検証から補正を
求めて、着地を予測する。実際の着地は、その月の支出の合計(特別費を含み、返金を差し引く)。

データは合成(\`scripts/forecast-eval/scenarios.ts\`)。休日・祝日・給料日からの日数による増減、
月ごとの季節、毎週の買い出し、休みの日の外食の高さ、2年で約2割の増加、稀に高額の支出、
月払いの請求(電気・携帯)、入力の遅れ(55%は当日、残りは1〜19日後)を入れてある。

世帯は4つ(\`EVAL_HOUSEHOLDS\`)。世帯ごとに乱数と暮らしの癖(外食の多さ・休日の強さ・給料日の効き方・
趣味の大きさ)を変えてある。1つの月の中の時点どうしは強く関係するので、月の数を多くして測る。

- **記録2年以上**:2024-01 から毎日つけている人。直近8か月 × 4世帯。
- **記録の空白あり**:2024年に数件だけ記録し、2025-10 から毎日つけている人。直近6か月 × 4世帯。
- **使い始めて60日**:テストする月の60日前から記録している人。季節は記録の短い人には分からないので、
  1年ぶんの月(12か月 × 4世帯)で測る。

v1 の行は、以前のエンジン(平均を見出し、幅の補正、検証の未来データ混入あり)を同じデータ・
同じ物差しで測った値(\`baseline-v1.json\`)。

## 結果

| データ | 時点数 | 80%の幅の的中率 | 序盤の的中率 | 中央値の偏り | 中央値の誤差 | 分位スコア |
|---|---|---|---|---|---|---|
${table}

- 中央値の偏り:(中央値 − 実際) ÷ 実際 の平均。負は低く出ている。
- 分位スコア:p10・p50・p90 のピンボール損失(CRPS の近似、円)。小さいほど良い。

## 目標(仕様の7章)

${targets}

## 残課題

- **本番データでの再評価**:このセッションには本番の明細へのアクセス手段が無い。アプリのレポート
  画面の「過去の月での検証」カードに、本人の記録での的中率が毎回出る。
`;

writeFileSync(OUT_PATH, md, 'utf8');
console.log(table);
console.log(targets);
console.log(`書き出しました: ${OUT_PATH}`);

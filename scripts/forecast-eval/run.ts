/**
 * 予測エンジンの評価(合成データ)。結果を docs/FORECAST_EVAL.md に書き出す。
 *
 * 本番の明細にはこのセッションから触れないため、実際の家計に近い構造と、外れやすい人物像
 * (設計書 v3 5.2)を入れた合成データで測る(scenarios.ts)。v2 の数字は、同じデータ・同じ物差しで
 * 測った値を baseline-v2.json に置いてあり、並べて表にする(`--write-baseline` で書き直す)。
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
const BASELINE_PATH = resolve(__dirname, 'baseline-v2.json');

const scenarios = evalScenarios();
const points = evaluate(scenarios, v2Engine, PAYDAY, (m) => console.log(m));

type Row = { name: string; metrics: EvalMetrics };
const PHASES = [
  { key: 'early', label: '序盤' },
  { key: 'mid', label: '中盤' },
  { key: 'late', label: '終盤' },
] as const;
/** 記録の長さ(設計書 v3 5.1:1か月未満・1〜3か月・3か月以上に分けて見る)。 */
const LENGTH_OF: Record<string, string> = {
  使い始めて20日: '1か月未満',
  使い始めて60日: '1〜3か月',
  記録の空白あり: '3か月以上',
  記録2年以上: '3か月以上',
};

function rowsOf(all: readonly EvalPoint[]): Row[] {
  const by = (key: (p: EvalPoint) => string) => {
    const groups = new Map<string, EvalPoint[]>();
    for (const p of all) groups.set(key(p), [...(groups.get(key(p)) ?? []), p]);
    return groups;
  };
  const group = (p: EvalPoint) => p.scenario.split('#')[0]!;
  return [
    { name: '全体', metrics: metricsOf(all) },
    ...PHASES.map((ph) => ({
      name: `時点:${ph.label}`,
      metrics: metricsOf(all.filter((p) => p.phase === ph.key)),
    })),
    ...['1か月未満', '1〜3か月', '3か月以上'].flatMap((len) => {
      const list = all.filter((p) => LENGTH_OF[group(p)] === len);
      return list.length > 0 ? [{ name: `記録:${len}`, metrics: metricsOf(list) }] : [];
    }),
    ...[...by(group).entries()].map(([name, list]) => ({ name, metrics: metricsOf(list) })),
  ];
}
const rows = rowsOf(points);
const baseline: Row[] | null = existsSync(BASELINE_PATH)
  ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Row[])
  : null;
if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
}
const v2Of = (name: string) => baseline?.find((b) => b.name === name)?.metrics;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const signed = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const yen = (v: number) => Math.round(v).toLocaleString('ja-JP');
const check = (ok: boolean) => (ok ? '✅' : '⚠️');

const mainTable = rows
  .map((row) => {
    const m = row.metrics;
    const v2 = v2Of(row.name);
    const best = Math.min(m.naivePaceScore, m.naiveLastMonthScore);
    return `| ${row.name} | ${m.count} | ${pct(m.coverage80)} | ${signed(m.sumBias)} | ${yen(m.score)} | ${
      v2 ? yen(v2.score) : '—'
    } | ${yen(m.naivePaceScore)} | ${yen(m.naiveLastMonthScore)} | ${check(
      m.score < best && (!v2 || m.score <= v2.score),
    )} |`;
  })
  .join('\n');

const overall = rows[0]!.metrics;
const pitRow = overall.pitDeciles.map((v) => pct(v)).join(' | ');
const pitOk = overall.pitDeciles.every((v) => v >= 0.07 && v <= 0.13);

// 注意の精度(設計書 v3 3.2、P1 の条件:70%以上)。時点帯ごと・データごと。
const precisionText = (m: EvalMetrics) =>
  m.cautionPrecision === null
    ? '出していない'
    : `${pct(m.cautionPrecision)}(${m.cautionsIssued}回)`;
const cautionRows = rows.map((row) => `| ${row.name} | ${precisionText(row.metrics)} |`).join('\n');

const phaseRows = rows.filter((r) => r.name.startsWith('時点:'));
const beatsAll = phaseRows.every((r) => {
  const m = r.metrics;
  const v2 = v2Of(r.name);
  return (
    m.score < Math.min(m.naivePaceScore, m.naiveLastMonthScore) && (!v2 || m.score <= v2.score)
  );
});
const targets = [
  `- 80%の幅の的中率:${pct(overall.coverage80)}(目標 75〜85%)${check(overall.coverage80 >= 0.75 && overall.coverage80 <= 0.85)}`,
  `- 中央値の偏り Σ(実際−中央値)÷Σ実際:${signed(overall.sumBias)}(目標 ±3%)${check(Math.abs(overall.sumBias) <= 0.03)}`,
  `- PIT の10等分:各 ${overall.pitDeciles.map((v) => (v * 100).toFixed(0)).join('・')}%(目標 各7〜13%)${check(pitOk)}`,
  `- CRPS:すべての時点帯で、v2 以下かつ単純な予想2つのうち良い方より小さい ${check(beatsAll)}`,
  `- 注意の精度:${
    overall.cautionPrecision === null ? '出していない' : pct(overall.cautionPrecision)
  }(目標 70%以上)${check(overall.cautionPrecision !== null && overall.cautionPrecision >= 0.7)}`,
].join('\n');

const md = `# 予測エンジンの評価(設計書 v3 の5章)

自動生成:\`npm run eval:forecast\`(\`scripts/forecast-eval/run.ts\`)。手で編集しないこと。

## 測り方

本番と同じ流れで測る。各月の2日おきの時点で、その時点までに**記録済み**の明細だけを使い
(記録した日で切る。入力の遅れがあるので、使った日では切らない)、完了した月での検証から補正を
求めて、着地を予測する。実際の着地は、その月の支出の合計(特別費を含み、返金を差し引く)。

データは合成(\`scripts/forecast-eval/scenarios.ts\`)。休日・祝日・給料日からの日数による増減、
月ごとの季節、毎週の買い出し、休みの日の外食の高さ、2年で約2割の増加、稀に高額の支出、
月払いの請求(電気・携帯)、入力の遅れ(55%は当日、残りは1〜19日後)を入れてある。

世帯は4つ。世帯ごとに乱数と暮らしの癖を変え、外れやすい人物像を重ねてある(設計書 v3 5.2):

- 世帯0:基本の世帯
- 世帯1:月初にまとめ買い(1.5万〜3万円)+ 旅行が年2回(3〜4日、まとめて5万〜10万円ほど)
- 世帯2:年払い・期ごとの税が多い(住民税・自動車税・固定資産税・保険の年払い・2年ごとの車検)+ 入力がだいたい3日遅れる
- 世帯3:月ごとに支出の水準が大きく揺れる(±20%ほど。収入も連動)+ 旅行が年2回

記録の長さ:

- **記録2年以上**:2024-01 から毎日つけている人。直近8か月 × 4世帯。
- **記録の空白あり**:2024年に数件だけ記録し、2025-10 から毎日つけている人。直近6か月 × 4世帯。
- **使い始めて60日**:テストする月の60日前から記録している人。1年ぶんの月 × 4世帯。
- **使い始めて20日**:テストする月の20日前から記録している人。半年ぶんの月 × 4世帯。

比べる相手(設計書 v3 5):v2(\`baseline-v2.json\`、同じデータ・同じ物差しで測った値)と、単純な予想2つ
(「このペースのまま」= 使った額 ÷ 経過日数 × 日数、「先月と同じ」= 先月の合計)。

## 結果

| データ | 時点数 | 80%の幅の的中率 | 偏り | CRPS | CRPS(v2) | このペース | 先月と同じ | v2・単純な予想より良い |
|---|---|---|---|---|---|---|---|---|
${mainTable}

- 偏り:Σ(実際 − 中央値) ÷ Σ実際。正は低く出ている。
- CRPS:着地の分位(5%〜95%の19点)のピンボール損失から求めた近似(円)。小さいほど良い。
  単純な予想は点の予想なので、CRPS は絶対誤差と同じ。

### PIT(全体を10等分した各区間の割合。平らなほど、確率が正しい)

| 0–10% | 10–20% | 20–30% | 30–40% | 40–50% | 50–60% | 60–70% | 70–80% | 80–90% | 90–100% |
|---|---|---|---|---|---|---|---|---|---|
| ${pitRow} |

## 注意の精度(設計書 v3 3.2)

ジャンルの目標は、各月の直前3か月の平均(3,000円以上のジャンルだけ)。本番と同じ関数
(\`landingRowsFrom\` → \`cautionsFor\`)で「このままだと」を出し、月末にそのジャンルが目標を
超えていれば当たり。完了した月での検証で精度が70%未満の時点帯は、本番と同じく出さない。

| データ | 精度(出した回数) |
|---|---|
${cautionRows}

## 目標(設計書 v3 の5.1・P2 の条件)

${targets}

## 残課題

- **本番データでの再評価**:このセッションには本番の明細へのアクセス手段が無い。アプリのレポート
  画面の「過去の月での検証」カードに、本人の記録での的中率が毎回出る。
`;

writeFileSync(OUT_PATH, md, 'utf8');
console.log(mainTable);
console.log(pitRow);
console.log(targets);
console.log(`書き出しました: ${OUT_PATH}`);

/**
 * 開発用の速い評価(世帯・時点を間引く)。モデルを変えたときに、前の結果と並べて比べる。
 * 本番の数字は run.ts(全部の世帯・2日おき)で出す。
 *
 * 実行例: EVAL_STEP=4 H=2 npx tsx scripts/forecast-eval/quick.ts --save v2
 *         EVAL_STEP=4 H=2 npx tsx scripts/forecast-eval/quick.ts --compare v2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { v2Engine } from './engines';
import { evaluate, metricsOf, type EvalMetrics, type EvalPoint } from './harness';
import { evalScenarios, PAYDAY } from './scenarios';

const dir = process.env.EVAL_QUICK_DIR ?? join(tmpdir(), 'forecast-eval-quick');
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const only = process.env.GROUP;
const scenarios = evalScenarios(Number(process.env.H ?? 2)).filter(
  (s) => !only || s.name.startsWith(only),
);
const points = evaluate(scenarios, v2Engine, PAYDAY);

const groups: [string, (p: EvalPoint) => boolean][] = [
  ['全体', () => true],
  ['序盤', (p) => p.phase === 'early'],
  ['中盤', (p) => p.phase === 'mid'],
  ['終盤', (p) => p.phase === 'late'],
  ['2年以上', (p) => p.scenario.startsWith('記録2年以上')],
  ['空白あり', (p) => p.scenario.startsWith('記録の空白あり')],
  ['60日', (p) => p.scenario.startsWith('使い始めて60日')],
  ['20日', (p) => p.scenario.startsWith('使い始めて20日')],
  ...[0, 1, 2, 3].map((h): [string, (p: EvalPoint) => boolean] => [
    `世帯${h}`,
    (p) => p.scenario.includes(`#${h}`),
  ]),
];
const result = Object.fromEntries(groups.map(([name, f]) => [name, metricsOf(points.filter(f))]));

const compareName = arg('--compare');
const before: Record<string, EvalMetrics> | null =
  compareName && existsSync(join(dir, `${compareName}.json`))
    ? (JSON.parse(readFileSync(join(dir, `${compareName}.json`), 'utf8')) as Record<
        string,
        EvalMetrics
      >)
    : null;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const yen = (v: number) => Math.round(v).toLocaleString('ja-JP');
for (const [name, m] of Object.entries(result)) {
  if (m.count === 0) continue;
  const b = before?.[name];
  const naive = Math.min(m.naivePaceScore, m.naiveLastMonthScore);
  console.log(
    `${name.padEnd(6)} n=${String(m.count).padStart(4)} 的中 ${pct(m.coverage80)}${
      b ? `(${pct(b.coverage80)})` : ''
    } 偏り ${pct(m.sumBias)}${b ? `(${pct(b.sumBias)})` : ''} CRPS ${yen(m.score)}${
      b ? `(${yen(b.score)})` : ''
    } 単純 ${yen(naive)} 注意 ${m.cautionPrecision === null ? '-' : pct(m.cautionPrecision)}`,
  );
}
console.log('PIT', result['全体']!.pitDeciles.map((v) => (v * 100).toFixed(0)).join(' '));
const saveName = arg('--save');
if (saveName) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${saveName}.json`), JSON.stringify(result), 'utf8');
}

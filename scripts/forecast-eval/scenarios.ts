/**
 * 評価用の合成データ(本番の明細には触れない)。実際の家計に近い構造を入れてある:
 * 曜日・祝日・給料日の増減、月ごとの季節、週1回の決まった買い出し、ゆるやかな増加、
 * 稀に高額の支出。決定論的な疑似乱数なので、実行のたびに同じデータになる。
 */

import type { ForecastSourceTransaction } from '../../src/domain/forecast/decompose';
import { isHoliday } from '../../src/domain/forecast/holidays';
import { eachDay } from '../../src/domain/period';
import { addDays, splitDateOnly, weekdayOf, type DateOnly } from '../../src/lib/date';

export const FROM: DateOnly = '2024-01-01';
export const TO: DateOnly = '2026-09-30';
export const PAYDAY = 25;

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
  let count = 0;
  let acc = -Math.log(rng());
  while (acc < mean) {
    count += 1;
    acc += -Math.log(rng());
  }
  return count;
}

const SEASON = [1, 1.0, 0.9, 1.0, 1.0, 1.1, 0.95, 1.2, 1.3, 1.0, 1.0, 1.05, 1.35];

function dayMultiplier(date: DateOnly, opts: { weekend: number; payday: number }): number {
  const wd = weekdayOf(date);
  let m = SEASON[splitDateOnly(date)[1]]!;
  if (wd === 0 || wd === 6 || isHoliday(date)) m *= opts.weekend;
  const day = splitDateOnly(date)[2];
  if (day >= PAYDAY && day < PAYDAY + 3) m *= opts.payday;
  // 2年かけて2割ほど増える(物価・生活水準の上昇)。
  const years = (Date.parse(date) - Date.parse(FROM)) / (365 * 86400000);
  return m * (1 + 0.1 * years);
}

function daily(
  id: string,
  name: string,
  mean: number,
  amount: number,
  spread: number,
  opts: { weekend: number; payday: number; weekdaysOnly?: boolean },
  seed: number,
): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  const out: ForecastSourceTransaction[] = [];
  for (const d of eachDay(FROM, TO)) {
    if (opts.weekdaysOnly && [0, 6].includes(weekdayOf(d))) continue;
    const count = poissonish(rng, mean * dayMultiplier(d, opts));
    for (let i = 0; i < count; i += 1) {
      const yen = Math.max(100, Math.round(amount + (rng() * 2 - 1) * spread));
      out.push(tx({ occurredOn: d, amountYen: -yen, genreId: id, genreName: name }));
    }
  }
  return out;
}

/** 毎週土曜にスーパーへ行く(たまに1日ずれる・行かない週もある)。 */
function weeklyStore(seed: number): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  const out: ForecastSourceTransaction[] = [];
  for (const d of eachDay(FROM, TO)) {
    if (weekdayOf(d) !== 6) continue;
    if (rng() < 0.12) continue;
    const shift = rng() < 0.2 ? (rng() < 0.5 ? -1 : 1) : 0;
    const date = addDays(d, shift);
    if (date > TO) continue;
    const season = SEASON[splitDateOnly(date)[1]]!;
    const yen = Math.round((3000 + rng() * 4000) * (0.9 + 0.1 * season));
    out.push(
      tx({
        occurredOn: date,
        amountYen: -yen,
        genreId: 'grocery',
        genreName: '食料品',
        merchantName: 'スーパーさくら',
      }),
    );
  }
  return out;
}

function rareLarge(seed: number): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  const out: ForecastSourceTransaction[] = [];
  for (const d of eachDay(FROM, TO)) {
    if (rng() < 1 / 45) {
      out.push(
        tx({
          occurredOn: d,
          amountYen: -Math.round(3000 + rng() * 15000),
          genreId: 'medical',
          genreName: '医療',
        }),
      );
    }
  }
  return out;
}

export function richTransactions(): ForecastSourceTransaction[] {
  return [
    ...daily('dining', '外食', 0.55, 1100, 500, { weekend: 1.6, payday: 1.5 }, 1),
    ...daily('conv', 'コンビニ', 0.45, 520, 220, { weekend: 1.1, payday: 1.1 }, 2),
    ...daily('transit', '交通費', 0.9, 420, 40, { weekend: 0, payday: 1, weekdaysOnly: true }, 3),
    ...daily('hobby', '娯楽・趣味', 1 / 6, 4000, 3000, { weekend: 1.8, payday: 1.7 }, 4),
    ...weeklyStore(5),
    ...rareLarge(6),
  ];
}

/** 直近の完了月(暦月)。 */
export function lastMonths(count: number): { from: DateOnly; to: DateOnly }[] {
  const out: { from: DateOnly; to: DateOnly }[] = [];
  for (let i = count; i >= 1; i -= 1) {
    const base = new Date(Date.UTC(2026, 8 - i, 1));
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    out.push({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` });
  }
  return out;
}

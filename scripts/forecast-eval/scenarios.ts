/**
 * 評価用の合成データ(本番の明細には触れない)。実際の家計に近い構造を入れてある:
 * 曜日・祝日・給料日からの日数による増減、月ごとの季節、週1回の決まった買い出し、ゆるやかな増加、
 * 稀に高額の支出、月払いの請求(電気・携帯)、給料、入力の遅れ(記録した日が使った日より後)。
 *
 * 世帯ごとに、外れやすい人物像(設計書 v3 5.2)を重ねる:
 *   世帯0:基本の世帯
 *   世帯1:月初にまとめ買い + 旅行が年2回
 *   世帯2:年払い・期ごとの税が多い + 入力が3日遅れる
 *   世帯3:月ごとに支出の水準が大きく揺れる(収入も月ごとに違う)+ 旅行が年2回
 * 決定論的な疑似乱数なので、実行のたびに同じデータになる。
 */

import type { ForecastSourceTransaction } from '../../src/domain/forecast/decompose';
import { isDayOff, isHoliday } from '../../src/domain/forecast/holidays';
import { payCycleBucket } from '../../src/domain/forecast/model';
import { eachDay } from '../../src/domain/period';
import { addDays, addMonths, splitDateOnly, weekdayOf, type DateOnly } from '../../src/lib/date';

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

type DayOpts = {
  weekend: number;
  payday: number;
  weekdaysOnly?: boolean;
  weekendAmount?: number;
  /** 月ごとの水準(月初の日付 → 倍率)。無ければ 1。 */
  monthLevel?: (monthStart: DateOnly) => number;
};

function dayMultiplier(date: DateOnly, opts: DayOpts): number {
  const wd = weekdayOf(date);
  let m = SEASON[splitDateOnly(date)[1]]! * (opts.monthLevel?.(`${date.slice(0, 7)}-01`) ?? 1);
  if (wd === 0 || wd === 6 || isHoliday(date)) m *= opts.weekend;
  // 給料日(土日祝なら前の平日)の直後は多く、給料日前の週は少ない。
  const bucket = payCycleBucket(date, PAYDAY);
  if (bucket === 0) m *= opts.payday;
  else if (bucket === 1) m *= 1 + (opts.payday - 1) / 2;
  else if (bucket === 4) m *= 0.85;
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
  opts: DayOpts,
  seed: number,
): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  const out: ForecastSourceTransaction[] = [];
  for (const d of eachDay(FROM, TO)) {
    if (opts.weekdaysOnly && [0, 6].includes(weekdayOf(d))) continue;
    const count = poissonish(rng, mean * dayMultiplier(d, opts));
    for (let i = 0; i < count; i += 1) {
      const dayOff = weekdayOf(d) === 0 || weekdayOf(d) === 6 || isHoliday(d);
      const scale = dayOff ? (opts.weekendAmount ?? 1) : 1;
      const yen = Math.max(100, Math.round((amount + (rng() * 2 - 1) * spread) * scale));
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

/** 月払いの請求:電気(27日ごろ、季節で金額が動く)と携帯(10日、毎月同じ額)。 */
function monthlyBills(seed: number): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  const out: ForecastSourceTransaction[] = [];
  for (let month = FROM; month <= TO; month = addMonths(month, 1)) {
    const season = SEASON[splitDateOnly(month)[1]]!;
    let electric = addDays(month, 26);
    while (isDayOff(electric)) electric = addDays(electric, 1);
    if (electric <= TO) {
      out.push(
        tx({
          occurredOn: electric,
          amountYen: -Math.round((6000 + rng() * 2000) * season),
          genreId: 'utility',
          genreName: '水道光熱',
          merchantName: 'でんき',
        }),
      );
    }
    const phone = addDays(month, 9);
    if (phone <= TO) {
      out.push(
        tx({
          occurredOn: phone,
          amountYen: -4378,
          genreId: 'utility',
          genreName: '水道光熱',
          merchantName: 'けいたい',
        }),
      );
    }
  }
  return out;
}

/** 給料(給料日、土日祝なら前の平日)。支出の予測には使わず、収支の計算に使う。 */
function salaries(
  income: (monthStart: DateOnly) => number = () => 250_000,
): ForecastSourceTransaction[] {
  const out: ForecastSourceTransaction[] = [];
  for (let month = FROM; month <= TO; month = addMonths(month, 1)) {
    let day = addDays(month, PAYDAY - 1);
    while (isDayOff(day)) day = addDays(day, -1);
    if (day <= TO) {
      out.push(
        tx({ occurredOn: day, amountYen: income(month), genreId: null, description: '給与' }),
      );
    }
  }
  return out;
}

/** 月初(1〜3日)に、大きな店でまとめ買い(1か月ぶんの食料品)。 */
function monthStartBulk(seed: number): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  const out: ForecastSourceTransaction[] = [];
  for (let month = FROM; month <= TO; month = addMonths(month, 1)) {
    const date = addDays(month, Math.floor(rng() * 3));
    if (date > TO || rng() < 0.08) continue;
    out.push(
      tx({
        occurredOn: date,
        amountYen: -Math.round(15000 + rng() * 15000),
        genreId: 'grocery',
        genreName: '食料品',
        merchantName: 'まとめ買いの店',
      }),
    );
  }
  return out;
}

/** 旅行が年2回(3〜4日。電車・宿・食事・おみやげ)。月は年ごとに乱数で決める。 */
function trips(seed: number): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  const out: ForecastSourceTransaction[] = [];
  const trip = (start: DateOnly) => {
    const days = 3 + Math.floor(rng() * 2);
    const add = (date: DateOnly, yen: number, merchant: string) => {
      if (date <= TO)
        out.push(
          tx({
            occurredOn: date,
            amountYen: -Math.round(yen),
            genreId: 'travel',
            genreName: '旅行',
            merchantName: merchant,
          }),
        );
    };
    add(start, 15000 + rng() * 20000, '新幹線');
    add(start, 12000 + rng() * 25000, '宿');
    for (let d = 0; d < days; d += 1) {
      const meals = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < meals; i += 1) add(addDays(start, d), 1500 + rng() * 4000, `食事${i}`);
    }
    add(addDays(start, days - 1), 3000 + rng() * 6000, 'おみやげ');
  };
  for (let year = 2024; year <= 2026; year += 1) {
    const first = 2 + Math.floor(rng() * 4);
    const second = 7 + Math.floor(rng() * 5);
    for (const month of [first, second]) {
      const start = `${year}-${String(month).padStart(2, '0')}-${String(5 + Math.floor(rng() * 18)).padStart(2, '0')}`;
      if (start >= FROM && start <= TO) trip(start);
    }
  }
  return out;
}

/**
 * 年払い・期ごとの支払い:住民税(普通徴収、6・8・10・1月)、自動車税(5月)、固定資産税(4・7・12・2月)、
 * 保険の年払い(11月)、2年ごとの車検(3月)。
 */
function annualPayments(seed: number): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  const out: ForecastSourceTransaction[] = [];
  const add = (date: DateOnly, yen: number, merchant: string) => {
    if (date >= FROM && date <= TO)
      out.push(
        tx({
          occurredOn: date,
          amountYen: -yen,
          genreId: 'tax',
          genreName: '保険・税金',
          merchantName: merchant,
        }),
      );
  };
  for (let year = 2024; year <= 2026; year += 1) {
    const day = (m: number, d: number) =>
      `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    for (const m of [6, 8, 10]) add(day(m, 28 + Math.floor(rng() * 2)), 31_000, '住民税');
    add(day(1, 28 + Math.floor(rng() * 2)), 31_000, '住民税');
    add(day(5, 20 + Math.floor(rng() * 8)), 36_000, '自動車税');
    for (const m of [4, 7, 12, 2]) add(day(m, 25 + Math.floor(rng() * 4)), 22_000, '固定資産税');
    add(day(11, 5 + Math.floor(rng() * 5)), 58_000, '保険の年払い');
    if (year % 2 === 1) add(day(3, 10 + Math.floor(rng() * 10)), 98_000, '車検');
  }
  return out;
}

/** 入力がだいたい3日遅れる人。 */
function withLateEntry(
  transactions: readonly ForecastSourceTransaction[],
  seed: number,
): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  return transactions.map((t) => {
    const r = rng();
    const lag = r < 0.2 ? 0 : r < 0.85 ? 3 : 4 + Math.floor(rng() * 4);
    return { ...t, createdOn: addDays(t.occurredOn, lag) };
  });
}

/** 月ごとの水準(対数正規、標準偏差 0.2)。同じ月の収入とも連動させる。 */
function monthLevels(seed: number): (monthStart: DateOnly) => number {
  const rng = mulberry32(seed);
  const levels = new Map<DateOnly, number>();
  for (let month = FROM; month <= TO; month = addMonths(month, 1)) {
    const u1 = Math.max(1e-9, rng());
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
    levels.set(month, Math.exp(0.2 * z));
  }
  return (monthStart) => levels.get(monthStart) ?? 1;
}

/**
 * 入力の遅れ:半分強はその日に記録、残りは数日〜2週間後にまとめて記録する。
 * 検証では、記録した日より前の時点からは、その明細は見えない。
 */
export function withEntryLag(
  transactions: readonly ForecastSourceTransaction[],
  seed: number,
): ForecastSourceTransaction[] {
  const rng = mulberry32(seed);
  return transactions.map((t) => {
    const r = rng();
    const lag =
      r < 0.55
        ? 0
        : r < 0.8
          ? 1 + Math.floor(rng() * 2)
          : r < 0.95
            ? 3 + Math.floor(rng() * 5)
            : 8 + Math.floor(rng() * 12);
    return { ...t, createdOn: addDays(t.occurredOn, lag) };
  });
}

/**
 * 1世帯ぶんの合成データ。household を変えると、乱数と暮らしの癖(外食の多さ・休日の強さ・
 * 給料日の効き方・趣味の大きさ)が変わる(household=0 が基本の世帯)。
 */
export function richTransactions(household = 0): ForecastSourceTransaction[] {
  const h = mulberry32(1000 + household);
  const vary = (base: number, spread: number) =>
    household === 0 ? base : base * (1 - spread + 2 * spread * h());
  const seed = (n: number) => n + household * 100;
  const persona = household % 4;
  const level = persona === 3 ? monthLevels(seed(9)) : undefined;
  const lv = level ? { monthLevel: level } : {};
  const spending = [
    // 外食は休日に回数が増え、1回の金額も大きい(居酒屋など)。
    ...daily(
      'dining',
      '外食',
      vary(0.55, 0.4),
      vary(1100, 0.3),
      500,
      {
        weekend: vary(1.6, 0.25),
        payday: vary(1.5, 0.3),
        weekendAmount: vary(1.9, 0.3),
        ...lv,
      },
      seed(1),
    ),
    ...daily(
      'conv',
      'コンビニ',
      vary(0.45, 0.4),
      520,
      220,
      { weekend: 1.1, payday: 1.1, ...lv },
      seed(2),
    ),
    ...daily(
      'transit',
      '交通費',
      0.9,
      420,
      40,
      { weekend: 0, payday: 1, weekdaysOnly: true },
      seed(3),
    ),
    ...daily(
      'hobby',
      '娯楽・趣味',
      vary(1 / 6, 0.4),
      vary(4000, 0.4),
      3000,
      { weekend: 1.8, payday: vary(1.7, 0.3), weekendAmount: 1.4, ...lv },
      seed(4),
    ),
    ...weeklyStore(seed(5)),
    ...rareLarge(seed(6)),
    ...monthlyBills(seed(7)),
    ...(persona === 1 ? monthStartBulk(seed(10)) : []),
    ...(persona === 1 || persona === 3 ? trips(seed(11)) : []),
    ...(persona === 2 ? annualPayments(seed(12)) : []),
  ];
  const lagged = persona === 2 ? withLateEntry(spending, seed(8)) : withEntryLag(spending, seed(8));
  const income = level
    ? (month: DateOnly) => Math.round((250_000 * (0.5 + level(month) / 2)) / 1000) * 1000
    : undefined;
  return [...lagged, ...salaries(income)].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
}

/**
 * 昔に少しだけ記録して、しばらく空いてから使い始めた人(記録の空白)。2024年に数件だけ記録し、
 * 2025-10 から毎日つけている。
 */
export function sparseStartTransactions(household = 0): ForecastSourceTransaction[] {
  const all = richTransactions(household);
  const continuous = all.filter((t) => t.occurredOn >= '2025-10-01');
  const old = all
    .filter((t) => t.occurredOn >= '2024-03-01' && t.occurredOn < '2024-05-01' && t.amountYen < 0)
    .filter((_, i) => i % 9 === 0);
  return [...old, ...continuous];
}

/** 使い始めて間もない人:各テスト月の60日前から記録している(過去の記録は無い)。 */
export function shortHistory(
  transactions: readonly ForecastSourceTransaction[],
  monthFrom: DateOnly,
  days = 60,
): ForecastSourceTransaction[] {
  const start = addDays(monthFrom, -days);
  return transactions.filter((t) => t.occurredOn >= start);
}

/** 直近の完了月(暦月)。 */
export function lastMonths(count: number): { from: DateOnly; to: DateOnly }[] {
  const out: { from: DateOnly; to: DateOnly }[] = [];
  for (let i = count; i >= 1; i -= 1) {
    const base = new Date(Date.UTC(2026, 8 - i, 1));
    // 2026-09 より前の、i か月前の月。
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    out.push({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` });
  }
  return out;
}

/** 評価に使う世帯の数(世帯ごとに乱数と暮らしの癖が違う)。 */
export const EVAL_HOUSEHOLDS = 4;

/** 評価に使うデータの組(run.ts)。名前の「#」より後は、同じ組の中の区別。 */
export function evalScenarios(households = EVAL_HOUSEHOLDS): {
  name: string;
  transactions: ForecastSourceTransaction[];
  months: { from: DateOnly; to: DateOnly }[];
}[] {
  const months = lastMonths(8);
  return Array.from({ length: households }, (_, household) => {
    const rich = richTransactions(household);
    return [
      { name: `記録2年以上#${household}`, transactions: rich, months },
      {
        name: `記録の空白あり#${household}`,
        transactions: sparseStartTransactions(household),
        months: months.slice(2),
      },
      // 季節は記録の短い人には分からないので、1年ぶんの月で測る(季節の上がり下がりを平均する)。
      ...lastMonths(12).map((m) => ({
        name: `使い始めて60日#${household}:${m.from}`,
        transactions: shortHistory(rich, m.from),
        months: [m],
      })),
      // 記録が1か月未満の人(テストする月の20日前から)。半年ぶんの月で測る。
      ...lastMonths(6).map((m) => ({
        name: `使い始めて20日#${household}:${m.from}`,
        transactions: shortHistory(rich, m.from, 20),
        months: [m],
      })),
    ];
  }).flat();
}

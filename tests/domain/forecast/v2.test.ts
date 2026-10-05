import { describe, expect, it } from 'vitest';

import { detectMonthlyBills, projectBills } from '@/domain/forecast/bills';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { buildForecast, phaseOf } from '@/domain/forecast/engine';
import { formatProbability } from '@/domain/forecast/format';
import { entryLagProfile, knownAt, recordedShare } from '@/domain/forecast/lag';
import { continuousRecordStart, periodIncome } from '@/domain/forecast/record';
import { buildCumulative } from '@/features/category/pace';
import { eachDay } from '@/domain/period';
import { addDays, addMonths } from '@/lib/date';

function tx(
  o: Partial<ForecastSourceTransaction> & { occurredOn: string; amountYen: number },
): ForecastSourceTransaction {
  return {
    genreId: 'dining',
    genreName: '外食',
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

const daily = (from: string, to: string, yen: number, genreId = 'dining') =>
  eachDay(from, to).map((d) => tx({ occurredOn: d, amountYen: -yen, genreId }));

const base = {
  period: { from: '2026-10-01', to: '2026-10-31' },
  today: '2026-10-15',
  trainingFrom: '2026-07-01',
  recordStart: '2026-07-01',
  confirmedFixedKeys: new Set<string>(),
  detectedSubscriptions: [],
  budgetYen: null,
  payday: 25,
  dataVersion: 'v',
  trials: 2000,
};

describe('月払いの請求', () => {
  const bill = (occurredOn: string, amountYen: number) => ({
    key: 'でんき',
    label: 'でんき',
    categoryId: 'utility',
    categoryName: '水道光熱',
    occurredOn,
    amountYen,
  });

  it('1か月おきの支払いを請求とみなし、3回以上なら確率0.95、金額がそろっていれば毎回その額', () => {
    const [b] = detectMonthlyBills(
      [bill('2026-07-27', 4378), bill('2026-08-27', 4378), bill('2026-09-27', 4378)],
      '2026-10-05',
    );
    expect(b).toMatchObject({ probability: 0.95, fixedYen: 4378, occurrences: 3 });
    const events = projectBills({
      bills: [b!],
      today: '2026-10-05',
      periodTo: '2026-10-31',
      scheduled: [],
    });
    expect(events.map((e) => e.date)).toEqual(['2026-10-27']);
  });

  it('間隔がそろっていない・金額がばらばらなら請求とみなさない', () => {
    expect(
      detectMonthlyBills([bill('2026-08-01', 3000), bill('2026-08-20', 3000)], '2026-09-01'),
    ).toEqual([]);
    expect(
      detectMonthlyBills([bill('2026-08-01', 1000), bill('2026-09-01', 9000)], '2026-09-05'),
    ).toEqual([]);
  });

  it('予定日を7日以内過ぎていれば明日に置き、同じ店の予定が近くにあれば数えない', () => {
    const [b] = detectMonthlyBills(
      [bill('2026-07-27', 6000), bill('2026-08-27', 6500), bill('2026-09-27', 7000)],
      '2026-10-30',
    );
    const late = projectBills({
      bills: [b!],
      today: '2026-10-30',
      periodTo: '2026-10-31',
      scheduled: [],
    });
    expect(late.map((e) => e.date)).toEqual(['2026-10-31']);
    const covered = projectBills({
      bills: [b!],
      today: '2026-10-05',
      periodTo: '2026-10-31',
      scheduled: [{ key: 'でんき', date: '2026-10-28' }],
    });
    expect(covered).toEqual([]);
  });
});

describe('入力の遅れ', () => {
  it('使った日から j 日後までに記録された割合 D(j) を求める', () => {
    const records = Array.from({ length: 40 }, (_, i) => ({
      occurredOn: '2026-07-01',
      createdOn: i < 20 ? '2026-07-01' : i < 30 ? '2026-07-02' : '2026-07-06',
    }));
    const d = entryLagProfile(records, '2026-10-01')!;
    expect(d[0]).toBeCloseTo(0.5);
    expect(d[1]).toBeCloseTo(0.75);
    expect(d[5]).toBeCloseTo(1);
    expect(recordedShare(d, 1)).toBeCloseTo(0.75);
    expect(recordedShare(null, 0)).toBe(1);
  });

  it('記録日時が少なければ遅れなし(null)', () => {
    expect(
      entryLagProfile([{ occurredOn: '2026-07-01', createdOn: '2026-07-01' }], '2026-10-01'),
    ).toBeNull();
  });

  it('記録した日で「その時点で知り得たか」を判断する', () => {
    expect(knownAt({ occurredOn: '2026-10-01', createdOn: '2026-10-04' }, '2026-10-02')).toBe(
      false,
    );
    expect(knownAt({ occurredOn: '2026-10-01' }, '2026-10-02')).toBe(true);
  });

  it('まだ記録されていない支出を着地に足す', () => {
    // 毎日1,000円、ただし記録は3日遅れ(履歴の記録日時から遅れを学ぶ)。今日までの3日分は未記録。
    const history = eachDay('2026-07-01', '2026-10-12').map((d) =>
      tx({ occurredOn: d, createdOn: addDays(d, 3), amountYen: -1000 }),
    );
    const f = buildForecast({ ...base, transactions: history });
    expect(f.unrecordedYen).toBeGreaterThan(1500);
    expect(f.unrecordedYen).toBeLessThan(5000);
  });
});

describe('記録の始まりと収入', () => {
  it('21日を超える空白があれば、その後からを記録の期間とする', () => {
    const txs = [
      tx({ occurredOn: '2024-03-01', amountYen: -500 }),
      ...daily('2026-08-01', '2026-10-01', 1000),
    ];
    expect(continuousRecordStart(txs, '2026-10-05')).toBe('2026-08-01');
    expect(continuousRecordStart([], '2026-10-05')).toBeNull();
  });

  it('給料が期間に入っていなければ直近3か月の給料の中央値を足し、入っていればそのまま', () => {
    const salary = (d: string, yen: number) => tx({ occurredOn: d, amountYen: yen, genreId: null });
    const history = [
      salary('2026-07-24', 240000),
      salary('2026-08-25', 250000),
      salary('2026-09-25', 260000),
    ];
    const period = { from: '2026-10-01', to: '2026-10-31' };
    expect(periodIncome({ transactions: history, period, takeHomeYen: null })).toEqual({
      yen: 250000,
      source: 'salary',
    });
    expect(
      periodIncome({
        transactions: [...history, salary('2026-10-23', 255000)],
        period,
        takeHomeYen: null,
      }),
    ).toEqual({ yen: 255000, source: 'salary' });
    expect(periodIncome({ transactions: [], period, takeHomeYen: 300000 })).toEqual({
      yen: 300000,
      source: 'setting',
    });
    expect(periodIncome({ transactions: [], period, takeHomeYen: 0 })).toBeNull();
  });
});

describe('同じ試行から全部の数字を出す', () => {
  const data = [
    ...daily('2026-07-01', '2026-10-15', 1000),
    ...daily('2026-07-01', '2026-10-15', 400, 'conv'),
    tx({ occurredOn: '2026-10-20', amountYen: -8000, genreId: 'conv' }),
  ];

  it('グラフの最終日 + 実績 = 着地。予定の日に段差がある', () => {
    const f = buildForecast({ ...base, transactions: data });
    const last = f.path.at(-1)!;
    expect(last.date).toBe('2026-10-31');
    expect(last.p10 + f.actualYen).toBe(f.total.p10);
    expect(last.p50 + f.actualYen).toBe(f.total.p50);
    expect(last.p90 + f.actualYen).toBe(f.total.p90);
    const at = (d: string) => f.path.find((p) => p.date === d)!.p50;
    expect(at('2026-10-20') - at('2026-10-19')).toBeGreaterThan(8000);
    for (let i = 1; i < f.path.length; i += 1) {
      expect(f.path[i]!.p50).toBeGreaterThanOrEqual(f.path[i - 1]!.p50);
    }
  });

  it('見出しは中央値、実績には特別費が入り、返金は差し引く', () => {
    const f = buildForecast({
      ...base,
      transactions: [
        ...data,
        tx({ occurredOn: '2026-10-05', amountYen: -30000, kind: 'special' }),
        tx({ occurredOn: '2026-10-06', amountYen: 2000, kind: 'refund' }),
      ],
    });
    expect(f.actualYen).toBe(15 * 1400 + 30000 - 2000);
    expect(f.total.p10).toBeLessThanOrEqual(f.total.p50);
    expect(f.total.p50).toBeLessThanOrEqual(f.total.p90);
  });

  it('グラフは日ごとの分位で描き、右端が着地と一致する', () => {
    const f = buildForecast({ ...base, transactions: data });
    const lines = data
      .filter((t) => t.occurredOn >= '2026-10-01')
      .map((t) => ({
        id: t.occurredOn,
        occurredOn: t.occurredOn,
        amountYen: t.amountYen,
        status: t.occurredOn > base.today ? ('scheduled' as const) : ('actual' as const),
        label: 'x',
      }));
    const chart = buildCumulative({
      lines: lines as never,
      monthStart: '2026-10-01',
      monthEnd: '2026-10-31',
      today: base.today,
      recordStart: '2026-10-01',
      goal: null,
      remaining: {
        lowYen: 0,
        medianYen: 0,
        highYen: 0,
        path: f.path.map((p) => ({
          date: p.date,
          lowYen: p.p10,
          medianYen: p.p50,
          highYen: p.p90,
        })),
      },
    });
    expect(chart.days.at(-1)!.forecastYen).toBe(f.total.p50);
    expect(chart.days.at(-1)!.forecastHighYen).toBe(f.total.p90);
  });

  it('理想の線は、決まっている支払いの段差と、いつもの使い方の割合で引き、最終日に予算に届く', () => {
    const f = buildForecast({ ...base, transactions: data });
    const chart = buildCumulative({
      lines: [],
      monthStart: '2026-10-01',
      monthEnd: '2026-10-31',
      today: base.today,
      recordStart: '2026-10-01',
      goal: { range: { from: '2026-10-01', to: '2026-10-31' }, budgetYen: 60000 },
      remaining: { lowYen: 0, medianYen: 0, highYen: 0, profile: f.typicalProfile },
    });
    expect(chart.days.at(-1)!.idealYen).toBe(60000);
    const at = (d: string) => chart.days.find((x) => x.date === d)!.idealYen!;
    expect(at('2026-10-20') - at('2026-10-19')).toBeGreaterThan(8000);
  });
});

describe('時点帯と確率の見せ方', () => {
  it('3分の1まで序盤、3分の2まで中盤、その後は終盤', () => {
    const period = { from: '2026-10-01', to: '2026-10-30' };
    expect(phaseOf(period, '2026-10-10')).toBe('early');
    expect(phaseOf(period, '2026-10-20')).toBe('mid');
    expect(phaseOf(period, '2026-10-21')).toBe('late');
  });

  it('99%以上・1%未満と言い切らずに出す', () => {
    expect(formatProbability(0.996)).toBe('99%以上');
    expect(formatProbability(0.004)).toBe('1%未満');
    expect(formatProbability(0.42)).toBe('42%');
  });
});

describe('月をまたぐ給料日の区分(addMonths の確認)', () => {
  it('addMonths は月末を超えない', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
});

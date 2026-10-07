import { describe, expect, it } from 'vitest';

import {
  allocateSavings,
  formatReachMonth,
  goalOutlook,
  monthlySavings,
  monthsSoonerWith,
  nextGoalRatio,
  recentMonthlySavings,
  savingsHeadline,
  savingsStartOf,
  savingsTotal,
  type SavingsGoalInput,
  type SavingsTransaction,
} from '@/domain/savings';

const tx = (occurredOn: string, amountYen: number, o: Partial<SavingsTransaction> = {}) => ({
  occurredOn,
  amountYen,
  isTransfer: false,
  reviewStatus: 'auto_ok',
  ...o,
});

describe('monthlySavings(収入 − 支出、今日までの実績だけ)', () => {
  const txs = [
    tx('2026-08-25', 250000),
    tx('2026-08-10', -180000),
    tx('2026-09-25', 250000),
    tx('2026-09-05', -230000),
    tx('2026-09-06', 5000, { kind: 'refund' }),
    tx('2026-09-07', -50000, { isTransfer: true }),
    tx('2026-09-08', -9000, { reviewStatus: 'ignored' }),
    tx('2026-10-03', -20000),
    tx('2026-10-25', 250000),
  ];
  const months = monthlySavings(txs, '2026-08-01', '2026-10-06');

  it('振替・対象外・今日より先は数えず、返金は支出から引く', () => {
    expect(months).toEqual([
      { monthKey: '2026-08', incomeYen: 250000, spendingYen: 180000, savedYen: 70000 },
      { monthKey: '2026-09', incomeYen: 250000, spendingYen: 225000, savedYen: 25000 },
      { monthKey: '2026-10', incomeYen: 0, spendingYen: 20000, savedYen: -20000 },
    ]);
  });

  it('合計は累計(使いすぎた月は減る)。マイナスなら 0', () => {
    expect(savingsTotal(months)).toBe(75000);
    expect(
      savingsTotal([{ monthKey: '2026-10', incomeYen: 0, spendingYen: 1, savedYen: -1 }]),
    ).toBe(0);
  });

  it('いつものペースは、直近の完了した月(最大3か月)の平均', () => {
    expect(recentMonthlySavings(months, '2026-10-06')).toBe(47500);
  });
});

describe('allocateSavings(期限の近い目標から順に満たす)', () => {
  const goal = (o: Partial<SavingsGoalInput> & { id: string }): SavingsGoalInput => ({
    title: o.id,
    targetAmountYen: 100000,
    targetDate: null,
    startOn: '2026-08-01',
    createdAt: '2026-08-01T00:00:00Z',
    ...o,
  });

  it('期限の近い順に割り当て、二重に数えない', () => {
    const out = allocateSavings({
      goals: [
        goal({ id: 'pc', targetAmountYen: 150000, targetDate: '2027-06-30' }),
        goal({ id: 'trip', targetAmountYen: 100000, targetDate: '2027-03-31' }),
        goal({ id: 'rainy', targetAmountYen: null }),
      ],
      totalYen: 130000,
      pace: 50000,
      today: '2026-10-06',
    });
    expect(out.map((p) => [p.goal.id, p.savedYen, p.remainingYen])).toEqual([
      ['trip', 100000, 0],
      ['pc', 30000, 120000],
      ['rainy', 0, null],
    ]);
    expect(out[0]!.reached).toBe(true);
  });

  it('期限までに毎月いくら要るか、いつものペースでいつ届くか', () => {
    const [trip, pc] = allocateSavings({
      goals: [
        goal({ id: 'trip', targetAmountYen: 300000, targetDate: '2027-03-31' }),
        goal({ id: 'pc', targetAmountYen: 100000, targetDate: '2027-06-30' }),
      ],
      totalYen: 60000,
      pace: 40000,
      today: '2026-10-06',
    });
    // 10月〜3月の6か月で 24万円 → 毎月 4万円。
    expect(trip!.monthsLeft).toBe(6);
    expect(trip!.monthlyNeededYen).toBe(40000);
    expect(trip!.reachMonth).toBe('2027-03');
    // 旅行のあとに PC:残り 24万 + 10万 = 34万 ÷ 4万 = 9か月 → 2027-06。
    expect(pc!.reachMonth).toBe('2027-06');
  });

  it('ペースが無い・0以下なら、届く月は出さない', () => {
    const [g] = allocateSavings({
      goals: [goal({ id: 'g' })],
      totalYen: 0,
      pace: -1000,
      today: '2026-10-06',
    });
    expect(g!.reachMonth).toBeNull();
  });

  it('数え始めは、進行中の目標のいちばん早い開始日', () => {
    expect(
      savingsStartOf([
        goal({ id: 'a', startOn: '2026-09-01' }),
        goal({ id: 'b', startOn: '2026-07-15' }),
      ]),
    ).toBe('2026-07-15');
    expect(savingsStartOf([])).toBeNull();
  });
});

describe('monthsSoonerWith(ちりつも)', () => {
  it('毎月の貯金が増えると、届くのが何か月早まるか', () => {
    expect(monthsSoonerWith({ remainingYen: 300000, pace: 30000, extraPerMonthYen: 10000 })).toBe(
      2,
    );
    expect(
      monthsSoonerWith({ remainingYen: 300000, pace: null, extraPerMonthYen: 10000 }),
    ).toBeNull();
  });
});

describe('formatReachMonth / goalOutlook', () => {
  it('今年なら月だけ、来年以降は年も出す', () => {
    expect(formatReachMonth('2026-12', '2026-10-07')).toBe('12月');
    expect(formatReachMonth('2027-03', '2026-10-07')).toBe('2027年3月');
  });

  it('期限と届く月をひとことにまとめる', () => {
    const [progress] = allocateSavings({
      goals: [
        {
          id: 'g1',
          title: '旅行',
          targetAmountYen: 120_000,
          targetDate: '2027-03-31',
          startOn: '2026-10-01',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      totalYen: 20_000,
      pace: 25_000,
      today: '2026-10-07',
    });
    expect(goalOutlook(progress!, '2026-10-07')).toBe(
      '期限まで毎月 16,667円・いまのペースなら2027年1月に届く',
    );
  });

  it('貯まった目標は「貯まりました」', () => {
    const [progress] = allocateSavings({
      goals: [
        {
          id: 'g1',
          title: '旅行',
          targetAmountYen: 10_000,
          targetDate: null,
          startOn: '2026-10-01',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      totalYen: 20_000,
      pace: null,
      today: '2026-10-07',
    });
    expect(goalOutlook(progress!, '2026-10-07')).toBe('貯まりました');
  });
});

describe('savingsHeadline / nextGoalRatio', () => {
  const goal = (id: string, targetAmountYen: number | null, targetDate: string | null) => ({
    id,
    title: id === 'a' ? '旅行' : '引っ越し',
    targetAmountYen,
    targetDate,
    startOn: '2026-09-01',
    createdAt: `2026-09-01T00:00:0${id === 'a' ? 0 : 1}Z`,
  });

  it('目標が無ければ今月の貯金', () => {
    expect(savingsHeadline({ totalYen: 0, thisMonthYen: -3_000, goals: [] })).toBe(
      '今月の貯金 −3,000円',
    );
    expect(nextGoalRatio([])).toBeNull();
  });

  it('次の目標(貯まっていない、期限の近いもの)までの残りを出す', () => {
    const goals = allocateSavings({
      goals: [goal('a', 10_000, '2026-12-31'), goal('b', 100_000, '2027-06-30')],
      totalYen: 30_000,
      pace: null,
      today: '2026-10-07',
    });
    expect(savingsHeadline({ totalYen: 30_000, thisMonthYen: 5_000, goals })).toBe(
      '貯金 30,000円・引っ越しまであと80,000円',
    );
    expect(nextGoalRatio(goals)).toBeCloseTo(0.2);
  });
});

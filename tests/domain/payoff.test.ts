import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_MONTHS,
  PayoffError,
  compareRefinance,
  comparePlans,
  simulateDebtPayoff,
  simulateTotalPayoff,
  summarizePayoff,
  withRefinancedRate,
  type Debt,
  type RepaymentStrategy,
} from '@/domain/payoff';

import golden from './fixtures/payoff-golden.json' with { type: 'json' };

/**
 * SQL 版(docs/schema.sql)と TypeScript 版(src/domain/payoff.ts)の一致検証。
 *
 * fixture は scripts/gen-payoff-golden.sh が実際の PostgreSQL から生成している。
 * ここが落ちたら、二重実装が乖離したということ。どちらかを直すのではなく、
 * どちらが正しいかを決めてから両方を揃えること(docs/architecture.md §3.1)。
 */

type GoldenSingleRow = {
  month_index: number;
  due_on: string;
  opening_balance_yen: number;
  interest_yen: number;
  principal_yen: number;
  payment_yen: number;
  closing_balance_yen: number;
};

type GoldenTotalRow = {
  month_index: number;
  month_on: string;
  opening_total_yen: number;
  interest_total_yen: number;
  principal_total_yen: number;
  payment_total_yen: number;
  closing_total_yen: number;
  debts_remaining: number;
};

type GoldenCase = {
  name: string;
  kind: 'single' | 'total' | 'refinanced';
  debtId?: string;
  strategy?: RepaymentStrategy;
  monthlyPaymentYen?: number;
  monthlyBudgetYen: number | null;
  rows: GoldenSingleRow[] | GoldenTotalRow[];
};

const debts: Debt[] = golden.debts.map((d) => ({
  id: d.id,
  balanceYen: d.balanceYen,
  annualRate: Number(d.annualRate),
  minimumPaymentYen: d.minimumPaymentYen,
  paymentDay: d.paymentDay,
}));

const baseMonth = golden.baseMonth;
const refinancedRate = Number(golden.refinancedAnnualRate);

describe('SQL 版との一致(golden fixture)', () => {
  for (const testCase of golden.cases as GoldenCase[]) {
    it(testCase.name, () => {
      if (testCase.kind === 'single') {
        const debt = debts.find((d) => d.id === testCase.debtId);
        expect(debt, `fixture の debtId が debts に存在しない: ${testCase.debtId}`).toBeDefined();

        const actual = simulateDebtPayoff(debt!, testCase.monthlyPaymentYen!, { baseMonth });
        const expected = testCase.rows as GoldenSingleRow[];

        expect(actual).toHaveLength(expected.length);
        expect(
          actual.map((r) => ({
            month_index: r.monthIndex,
            due_on: r.dueOn,
            opening_balance_yen: r.openingBalanceYen,
            interest_yen: r.interestYen,
            principal_yen: r.principalYen,
            payment_yen: r.paymentYen,
            closing_balance_yen: r.closingBalanceYen,
          })),
        ).toEqual(expected);
        return;
      }

      const target =
        testCase.kind === 'refinanced' ? withRefinancedRate(debts, refinancedRate) : debts;

      const actual = simulateTotalPayoff(
        target,
        testCase.monthlyBudgetYen === null
          ? { strategy: testCase.strategy }
          : { monthlyBudgetYen: testCase.monthlyBudgetYen, strategy: testCase.strategy },
        { baseMonth },
      );
      const expected = testCase.rows as GoldenTotalRow[];

      expect(actual).toHaveLength(expected.length);
      expect(
        actual.map((r) => ({
          month_index: r.monthIndex,
          month_on: r.dueOn,
          opening_total_yen: r.openingBalanceYen,
          interest_total_yen: r.interestYen,
          principal_total_yen: r.principalYen,
          payment_total_yen: r.paymentYen,
          closing_total_yen: r.closingBalanceYen,
          debts_remaining: r.debtsRemaining,
        })),
      ).toEqual(expected);
    });
  }
});

describe('simulateDebtPayoff', () => {
  const debt: Debt = {
    id: 'a',
    balanceYen: 100_000,
    annualRate: 0.15,
    minimumPaymentYen: 5_000,
    paymentDay: 27,
  };

  it('最終月の返済額は残高+利息までに収まる(払いすぎない)', () => {
    const rows = simulateDebtPayoff(debt, 30_000, { baseMonth: '2026-09-01' });
    const last = rows[rows.length - 1]!;
    expect(last.closingBalanceYen).toBe(0);
    expect(last.paymentYen).toBeLessThanOrEqual(last.openingBalanceYen + last.interestYen);
    expect(last.paymentYen).toBeLessThan(30_000);
  });

  it('各月で 元本 = 返済額 - 利息 が成り立つ', () => {
    for (const row of simulateDebtPayoff(debt, 30_000, { baseMonth: '2026-09-01' })) {
      expect(row.principalYen).toBe(row.paymentYen - row.interestYen);
      expect(row.closingBalanceYen).toBe(row.openingBalanceYen - row.principalYen);
    }
  });

  it('金利0%なら利息は発生せず、単純な割り算になる', () => {
    const rows = simulateDebtPayoff({ ...debt, annualRate: 0 }, 25_000, {
      baseMonth: '2026-09-01',
    });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.interestYen === 0)).toBe(true);
  });

  it('返済額が利息を下回るとエラーになる(無限に返し続けない)', () => {
    // 残高10万円・年利15% の月利息は 1,250 円
    expect(() => simulateDebtPayoff(debt, 1_000, { baseMonth: '2026-09-01' })).toThrow(PayoffError);
    expect(() => simulateDebtPayoff(debt, 1_250, { baseMonth: '2026-09-01' })).toThrow(
      /利息 1250 円を下回る/,
    );
  });

  it('利息をわずかに上回れば完済する(境界)', () => {
    const rows = simulateDebtPayoff(debt, 1_251, { baseMonth: '2026-09-01' });
    expect(rows[rows.length - 1]!.closingBalanceYen).toBe(0);
  });

  it('月額返済額が0以下ならエラー', () => {
    expect(() => simulateDebtPayoff(debt, 0)).toThrow(/正の値/);
    expect(() => simulateDebtPayoff(debt, -1)).toThrow(/正の値/);
  });

  it('残高1円でも1ヶ月で終わる', () => {
    const rows = simulateDebtPayoff({ ...debt, balanceYen: 1 }, 30_000, {
      baseMonth: '2026-09-01',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.interestYen).toBe(0); // floor(1 * 0.15 / 12) = 0
    expect(rows[0]!.paymentYen).toBe(1);
  });

  it('返済日 31 は月末差異を避けるため 28 に丸められる', () => {
    const rows = simulateDebtPayoff({ ...debt, paymentDay: 31 }, 30_000, {
      baseMonth: '2026-09-01',
    });
    expect(rows[0]!.dueOn).toBe('2026-10-28');
  });

  it('打ち切り月数を超えるとエラー', () => {
    expect(() =>
      simulateDebtPayoff({ ...debt, balanceYen: 10_000_000 }, 130_000, {
        baseMonth: '2026-09-01',
        maxMonths: 3,
      }),
    ).toThrow(/3 ヶ月以内に完済しません/);
  });
});

describe('simulateTotalPayoff', () => {
  const many: Debt[] = [
    { id: 'low', balanceYen: 100_000, annualRate: 0.05, minimumPaymentYen: 3_000, paymentDay: 27 },
    { id: 'high', balanceYen: 300_000, annualRate: 0.18, minimumPaymentYen: 9_000, paymentDay: 5 },
  ];

  it('アバランチは高金利から先に消える', () => {
    const rows = simulateTotalPayoff(
      many,
      { monthlyBudgetYen: 60_000, strategy: 'avalanche' },
      { baseMonth: '2026-09-01' },
    );
    // 高金利(残高30万)が先に消えるので、2件残っている期間の方が長い
    const monthTwoDebtsGone = rows.findIndex((r) => r.debtsRemaining === 1);
    expect(monthTwoDebtsGone).toBeGreaterThan(0);
    expect(rows[rows.length - 1]!.closingBalanceYen).toBe(0);
  });

  it('アバランチはスノーボールより総利息が少ない(ADR-013 の根拠)', () => {
    const opts = { baseMonth: '2026-09-01' };
    const avalanche = summarizePayoff(
      simulateTotalPayoff(many, { monthlyBudgetYen: 60_000, strategy: 'avalanche' }, opts),
    );
    const snowball = summarizePayoff(
      simulateTotalPayoff(many, { monthlyBudgetYen: 60_000, strategy: 'snowball' }, opts),
    );
    expect(avalanche.totalInterestYen).toBeLessThan(snowball.totalInterestYen);
  });

  it('最低返済のみでは月額予算を指定しなくてよい', () => {
    const rows = simulateTotalPayoff(many, { strategy: 'minimum' }, { baseMonth: '2026-09-01' });
    expect(rows.length).toBeGreaterThan(0);
    // 債務が減ると月々の支払総額も減る
    expect(rows[rows.length - 1]!.paymentYen).toBeLessThan(rows[0]!.paymentYen);
  });

  it('最低返済のみは余剰を充当しない(支払額が最低額の合計を超えない)', () => {
    const rows = simulateTotalPayoff(many, { strategy: 'minimum' }, { baseMonth: '2026-09-01' });
    const maxMinimums = many.reduce((acc, d) => acc + d.minimumPaymentYen, 0);
    expect(rows.every((r) => r.paymentYen <= maxMinimums)).toBe(true);
  });

  it('minimum 以外で月額予算がなければエラー', () => {
    expect(() => simulateTotalPayoff(many, { strategy: 'avalanche' })).toThrow(/正の値/);
    expect(() => simulateTotalPayoff(many, { monthlyBudgetYen: 0 })).toThrow(/正の値/);
  });

  it('残高が減らない月額はエラーにする(無限ループにしない)', () => {
    expect(() =>
      simulateTotalPayoff(
        many,
        { monthlyBudgetYen: 1_000, strategy: 'avalanche' },
        { baseMonth: '2026-09-01' },
      ),
    ).toThrow(/残高が減りません/);
  });

  it('債務がなければ空を返す', () => {
    expect(simulateTotalPayoff([], { monthlyBudgetYen: 50_000 })).toEqual([]);
    expect(
      simulateTotalPayoff([{ ...many[0]!, balanceYen: 0 }], { monthlyBudgetYen: 50_000 }),
    ).toEqual([]);
  });

  it('各月で 元本 = 支払総額 - 利息総額、残高の推移も整合する', () => {
    const rows = simulateTotalPayoff(
      many,
      { monthlyBudgetYen: 60_000, strategy: 'avalanche' },
      { baseMonth: '2026-09-01' },
    );
    for (const row of rows) {
      expect(row.principalYen).toBe(row.paymentYen - row.interestYen);
      expect(row.closingBalanceYen).toBe(row.openingBalanceYen + row.interestYen - row.paymentYen);
    }
  });

  it('入力の配列を書き換えない', () => {
    const snapshot = JSON.parse(JSON.stringify(many));
    simulateTotalPayoff(many, { monthlyBudgetYen: 60_000 }, { baseMonth: '2026-09-01' });
    expect(many).toEqual(snapshot);
  });

  it('既定の打ち切り月数は 600', () => {
    expect(DEFAULT_MAX_MONTHS).toBe(600);
  });
});

describe('comparePlans(FR-02)', () => {
  it('最低返済のみとの差分として削減利息と短縮月数を返す', () => {
    const result = comparePlans(debts, 100_000, { baseMonth });
    expect(result.baseline.months).toBeGreaterThan(result.proposed.months);
    expect(result.savedInterestYen).toBeGreaterThan(0);
    expect(result.shortenedMonths).toBe(result.baseline.months - result.proposed.months);
  });
});

describe('withRefinancedRate(FR-04)', () => {
  it('全債務の金利を置き換え、元の配列は変えない', () => {
    const refinanced = withRefinancedRate(debts, 0.08);
    expect(refinanced.every((d) => d.annualRate === 0.08)).toBe(true);
    expect(debts.some((d) => d.annualRate !== 0.08)).toBe(true);
  });

  it('借り換えると総利息が減る', () => {
    const before = summarizePayoff(
      simulateTotalPayoff(debts, { monthlyBudgetYen: 100_000 }, { baseMonth }),
    );
    const after = summarizePayoff(
      simulateTotalPayoff(
        withRefinancedRate(debts, 0.08),
        { monthlyBudgetYen: 100_000 },
        {
          baseMonth,
        },
      ),
    );
    expect(after.totalInterestYen).toBeLessThan(before.totalInterestYen);
  });

  it('パーセント値を渡すとエラー(8% は 0.08)', () => {
    expect(() => withRefinancedRate(debts, 8)).toThrow(/0〜1 の小数/);
  });
});

describe('compareRefinance(FR-04)', () => {
  it('金利を下げると削減利息・短縮月数が正になる', () => {
    const result = compareRefinance(debts, 100_000, 0.08, { baseMonth });
    expect(result.savedInterestYen).toBeGreaterThan(0);
    expect(result.shortenedMonths).toBeGreaterThanOrEqual(0);
    expect(result.shortenedMonths).toBe(result.original.months - result.refinanced.months);
  });

  it('月額返済額は変えず、金利だけを変えた効果を見る', () => {
    const result = compareRefinance(debts, 100_000, 0.08, { baseMonth });
    const plain = summarizePayoff(
      simulateTotalPayoff(debts, { monthlyBudgetYen: 100_000 }, { baseMonth }),
    );
    expect(result.original).toEqual(plain);
  });
});

describe('summarizePayoff', () => {
  it('空のスケジュールはエラー', () => {
    expect(() => summarizePayoff([])).toThrow(PayoffError);
  });
});

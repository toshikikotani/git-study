/**
 * ホーム画面に出す3つの数字(FR-03, FR-14, FR-61)。
 *
 *   1. 完済まで残り日数 / 残り金額
 *   2. 生活費の残額
 *   3. 女遊び枠の残額
 *
 * 数字は3個までに絞る。増やしたくなったら下層画面へ置くこと。
 * 「見るべきものが3つしかない」ことが、開き続けられる条件になる(FR-61)。
 *
 * ── データ源について ────────────────────────────────────────
 * 現在は ADR-006 の仮置き値を返す。Supabase 接続(M0-2/M0-3)が済んだら
 * loadHomeSummary() の中身だけを差し替える。呼び出し側と表示は変わらない。
 */

import { simulateTotalPayoff, summarizePayoff, type Debt } from '@/domain/payoff';
import { daysBetween, monthStartJst, todayJst, type DateOnly } from '@/lib/date';

export type HomeSummary = {
  payoff: {
    /** 残債総額(円)。 */
    remainingYen: number;
    /** 完済予定日。債務がなければ null。 */
    payoffOn: DateOnly | null;
    /** 完済までの残り日数。債務がなければ null。 */
    daysRemaining: number | null;
    /** 返済済みの割合(0〜1)。進捗ゲージ用(FR-63)。 */
    progressRatio: number;
    /**
     * 残高・金利が本人の実確認を経ていない債務が含まれるか(ADR-006)。
     * true のあいだ、完済予定日を確定値として表示してはならない。
     */
    isEstimated: boolean;
  };
  living: BudgetRemaining;
  sanctuary: BudgetRemaining;
};

export type BudgetRemaining = {
  budgetYen: number;
  spentYen: number;
  /** 残額。マイナスもありうる(超過)。 */
  remainingYen: number;
  /** 消化率。予算が0なら null。 */
  usageRatio: number | null;
};

export function computeBudgetRemaining(budgetYen: number, spentYen: number): BudgetRemaining {
  return {
    budgetYen,
    spentYen,
    remainingYen: budgetYen - spentYen,
    usageRatio: budgetYen > 0 ? spentYen / budgetYen : null,
  };
}

export type PayoffInput = {
  debts: readonly Debt[];
  monthlyBudgetYen: number;
  /** 当初の負債総額。進捗ゲージの分母に使う。 */
  originalTotalYen: number;
  isEstimated: boolean;
};

export function computePayoffSummary(
  input: PayoffInput,
  now: Date = new Date(),
): HomeSummary['payoff'] {
  const remainingYen = input.debts.reduce((acc, d) => acc + d.balanceYen, 0);
  const paidYen = Math.max(input.originalTotalYen - remainingYen, 0);
  const progressRatio = input.originalTotalYen > 0 ? paidYen / input.originalTotalYen : 1;

  if (remainingYen <= 0) {
    return {
      remainingYen: 0,
      payoffOn: null,
      daysRemaining: null,
      progressRatio: 1,
      isEstimated: false,
    };
  }

  const rows = simulateTotalPayoff(
    input.debts,
    { monthlyBudgetYen: input.monthlyBudgetYen, strategy: 'avalanche' },
    { baseMonth: monthStartJst(0, now) },
  );
  const summary = summarizePayoff(rows);

  return {
    remainingYen,
    payoffOn: summary.payoffOn,
    daysRemaining: daysBetween(todayJst(now), summary.payoffOn),
    progressRatio,
    isEstimated: input.isEstimated,
  };
}

/**
 * ADR-006 の仮置きデータ。M0-2/M0-3 の完了後、ここを Supabase 読み出しに差し替える。
 * 仮値のまま画面を出すのは意図的で、この画面自体を棚卸しのフォームにするため。
 */
const PLACEHOLDER_DEBTS: Debt[] = [
  {
    id: 'dddddddd-0000-0000-0000-000000000001',
    balanceYen: 400_000,
    annualRate: 0.15,
    minimumPaymentYen: 10_000,
    paymentDay: 27,
  },
  {
    id: 'dddddddd-0000-0000-0000-000000000002',
    balanceYen: 300_000,
    annualRate: 0.15,
    minimumPaymentYen: 8_000,
    paymentDay: 27,
  },
  {
    id: 'dddddddd-0000-0000-0000-000000000003',
    balanceYen: 300_000,
    annualRate: 0.18,
    minimumPaymentYen: 9_000,
    paymentDay: 5,
  },
];

export async function loadHomeSummary(now: Date = new Date()): Promise<HomeSummary> {
  // TODO(M0-3): Supabase から debts / app_settings / v_current_month_budget_status を読む
  return {
    payoff: computePayoffSummary(
      {
        debts: PLACEHOLDER_DEBTS,
        monthlyBudgetYen: 100_000, // app_settings.monthly_repayment_target_yen
        originalTotalYen: 1_000_000,
        isEstimated: true,
      },
      now,
    ),
    living: computeBudgetRemaining(60_000, 0),
    sanctuary: computeBudgetRemaining(40_000, 0),
  };
}

/**
 * 完済シミュレーション(FR-02, FR-04)。
 *
 * ここは本システムで最も重要な計算である。ホーム最上部の完済カウントダウン(FR-03)も、
 * 借り換えの判断(FR-04)も、すべてこの出力に依存する。
 *
 * ── SQL 版との二重実装について ──────────────────────────────────
 * 同じ計算が public.simulate_debt_payoff() / public.simulate_total_payoff() にもある。
 * SQL 版は朝配信ジョブと本人による検算のため、TS 版は画面上でスライダーを
 * 動かしながら即座に再計算するため(往復レイテンシがあると使い物にならない)。
 *
 * 両者が一致することは tests/domain/payoff.test.ts が保証する。
 * この対応を欠くと数字が二種類存在することになり、システムの信頼が崩れる。
 * ロジックを変えるときは必ず docs/schema.sql と揃えること。
 *
 * ── 計算モデル ──────────────────────────────────────────────
 *   毎月末に「残高 × 年利 ÷ 12」を単利で計上し、返済は利息 → 元本の順に充当する。
 *   円未満は切り捨て(Math.floor)。日割りより粗いが、比較目的には十分で、
 *   本人が電卓で検算できる。SQL の floor() と一致させるためでもある。
 */

import { monthlyInterest, assertYen } from './money';
import { addMonthsToParts, monthStartJst, splitDateOnly, type DateOnly } from '@/lib/date';

export const DEFAULT_MAX_MONTHS = 600;

/** 返済戦略(ADR-013)。DB の repayment_strategy 型と対応する。 */
export type RepaymentStrategy = 'avalanche' | 'snowball' | 'minimum';

export type Debt = {
  id: string;
  /** 現在残高(円)。 */
  balanceYen: number;
  /** 年利。小数で受ける(15% → 0.15)。 */
  annualRate: number;
  /** 最低返済額(円)。 */
  minimumPaymentYen: number;
  /** 返済日(1〜31)。29〜31 は月末差異を避けるため 28 に丸めて扱う。 */
  paymentDay: number;
};

export type PayoffRow = {
  monthIndex: number;
  /** 単一債務では返済日、合算では月初日。 */
  dueOn: DateOnly;
  openingBalanceYen: number;
  interestYen: number;
  principalYen: number;
  paymentYen: number;
  closingBalanceYen: number;
};

export type TotalPayoffRow = PayoffRow & {
  /** その月末時点で残っている債務の件数。 */
  debtsRemaining: number;
};

export type PayoffSummary = {
  months: number;
  payoffOn: DateOnly;
  totalInterestYen: number;
  totalPaidYen: number;
};

export class PayoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoffError';
  }
}

type SimulateOptions = {
  /** 基準となる月初日。省略時は JST の当月。テストではここを固定する。 */
  baseMonth?: DateOnly | undefined;
  maxMonths?: number | undefined;
};

/**
 * 単一債務の償還スケジュール(FR-02)。
 * SQL の public.simulate_debt_payoff() と同一の結果を返す。
 */
export function simulateDebtPayoff(
  debt: Debt,
  monthlyPaymentYen: number,
  options: SimulateOptions = {},
): PayoffRow[] {
  assertYen(debt.balanceYen, '残高');
  assertYen(monthlyPaymentYen, '月額返済額');

  if (monthlyPaymentYen <= 0) {
    throw new PayoffError(`月額返済額は正の値である必要があります(指定値: ${monthlyPaymentYen})`);
  }

  const maxMonths = options.maxMonths ?? DEFAULT_MAX_MONTHS;
  const [baseYear, baseMonth] = splitDateOnly(options.baseMonth ?? monthStartJst());
  const paymentDay = Math.min(debt.paymentDay, 28);

  const rows: PayoffRow[] = [];
  let balance = debt.balanceYen;

  while (balance > 0 && rows.length < maxMonths) {
    const monthIndex = rows.length + 1;
    const interestYen = monthlyInterest(balance, debt.annualRate);
    const paymentYen = Math.min(monthlyPaymentYen, balance + interestYen);

    if (paymentYen <= interestYen) {
      throw new PayoffError(
        `月額 ${monthlyPaymentYen} 円では利息 ${interestYen} 円を下回るため完済できません`,
      );
    }

    const principalYen = paymentYen - interestYen;
    const openingBalanceYen = balance;
    balance -= principalYen;

    rows.push({
      monthIndex,
      dueOn: addMonthsToParts(baseYear, baseMonth, paymentDay, monthIndex),
      openingBalanceYen,
      interestYen,
      principalYen,
      paymentYen,
      closingBalanceYen: balance,
    });
  }

  if (balance > 0) {
    throw new PayoffError(`${maxMonths} ヶ月以内に完済しません(残高 ${balance} 円)`);
  }

  return rows;
}

/**
 * 全債務を合算したシミュレーション(FR-02, FR-04)。
 * SQL の public.simulate_total_payoff() と同一の結果を返す。
 *
 * strategy が 'minimum' のとき monthlyBudgetYen は無視され、
 * 残っている債務の最低返済額の合計だけが充てられる(比較の基準)。
 */
export function simulateTotalPayoff(
  debts: readonly Debt[],
  params: { monthlyBudgetYen?: number | undefined; strategy?: RepaymentStrategy | undefined },
  options: SimulateOptions = {},
): TotalPayoffRow[] {
  const strategy = params.strategy ?? 'avalanche';
  const maxMonths = options.maxMonths ?? DEFAULT_MAX_MONTHS;
  const [baseYear, baseMonth] = splitDateOnly(options.baseMonth ?? monthStartJst());

  if (strategy !== 'minimum') {
    if (params.monthlyBudgetYen === undefined || params.monthlyBudgetYen <= 0) {
      throw new PayoffError(
        `月額予算は正の値である必要があります(指定値: ${params.monthlyBudgetYen})`,
      );
    }
    assertYen(params.monthlyBudgetYen, '月額予算');
  }

  const ordered = orderDebtsForStrategy(debts, strategy);
  if (ordered.length === 0) return [];

  const balances = ordered.map((d) => d.balanceYen);
  const rows: TotalPayoffRow[] = [];

  while (rows.length < maxMonths) {
    const openingBalanceYen = sum(balances);
    if (openingBalanceYen <= 0) break;

    const monthIndex = rows.length + 1;
    let paymentTotal = 0;

    // (1) 利息を計上して残高に加える
    const interestTotal = accrueInterest(balances, ordered);

    // (2) 全債務へ最低返済額を充てる。予算は毎月ここでリセットする。
    let budget =
      strategy === 'minimum'
        ? ordered.reduce((acc, d, k) => (balances[k]! > 0 ? acc + d.minimumPaymentYen : acc), 0)
        : params.monthlyBudgetYen!;

    const minimumResult = applyBudget(balances, budget, (k) => ordered[k]!.minimumPaymentYen);
    paymentTotal += minimumResult.paidYen;
    budget = minimumResult.remainingBudget;

    // (3) 余剰を戦略順に充てる。'minimum' は最低返済のみを再現するので行わない。
    if (strategy !== 'minimum') {
      paymentTotal += applyBudget(balances, budget).paidYen;
    }

    const closingBalanceYen = sum(balances);

    // 残高が減らない月額は完済に到達しない。無限ループにせず明示的に落とす。
    if (closingBalanceYen >= openingBalanceYen) {
      throw new PayoffError(
        `月額 ${params.monthlyBudgetYen ?? 0} 円では残高が減りません` +
          `(月初 ${openingBalanceYen} 円 → 月末 ${closingBalanceYen} 円)。` +
          `利息 ${interestTotal} 円を上回る返済が必要です。`,
      );
    }

    rows.push({
      monthIndex,
      dueOn: addMonthsToParts(baseYear, baseMonth, 1, monthIndex),
      openingBalanceYen,
      interestYen: interestTotal,
      principalYen: paymentTotal - interestTotal,
      paymentYen: paymentTotal,
      closingBalanceYen,
      debtsRemaining: balances.filter((b) => b > 0).length,
    });
  }

  return rows;
}

/** スケジュールを1行の要約にする。画面の比較表とホームのカウントダウンで使う。 */
export function summarizePayoff(rows: readonly PayoffRow[]): PayoffSummary {
  if (rows.length === 0) {
    throw new PayoffError('スケジュールが空です。返済すべき債務がありません。');
  }
  const last = rows[rows.length - 1]!;
  return {
    months: rows.length,
    payoffOn: last.dueOn,
    totalInterestYen: rows.reduce((acc, r) => acc + r.interestYen, 0),
    totalPaidYen: rows.reduce((acc, r) => acc + r.paymentYen, 0),
  };
}

/**
 * FR-02:「最低返済のみ」と「月X万円返済」を並べて比較する。
 * 削減できる利息と短縮できる月数を返す。この差額が本システムの説得力そのもの。
 */
export function comparePlans(
  debts: readonly Debt[],
  monthlyBudgetYen: number,
  options: SimulateOptions & { strategy?: RepaymentStrategy | undefined } = {},
): {
  baseline: PayoffSummary;
  proposed: PayoffSummary;
  savedInterestYen: number;
  shortenedMonths: number;
} {
  const baseline = summarizePayoff(simulateTotalPayoff(debts, { strategy: 'minimum' }, options));
  const proposed = summarizePayoff(
    simulateTotalPayoff(
      debts,
      { monthlyBudgetYen, strategy: options.strategy ?? 'avalanche' },
      options,
    ),
  );

  return {
    baseline,
    proposed,
    savedInterestYen: baseline.totalInterestYen - proposed.totalInterestYen,
    shortenedMonths: baseline.months - proposed.months,
  };
}

/**
 * FR-04:借り換えシミュレーション。全債務の金利を指定値に置き換える。
 * DB は変更しない。画面上の試算にのみ使う。
 */
export function withRefinancedRate(debts: readonly Debt[], annualRate: number): Debt[] {
  if (!Number.isFinite(annualRate) || annualRate < 0 || annualRate > 1) {
    throw new PayoffError(`年利は 0〜1 の小数で指定してください(8% なら 0.08): ${annualRate}`);
  }
  return debts.map((d) => ({ ...d, annualRate }));
}

/**
 * FR-04:現在の金利のままの場合と、借り換えて金利を置き換えた場合を
 * 同じ月額返済額で比較する。comparePlans() が「返済額を変えた効果」を
 * 見るのに対し、こちらは「金利だけを変えた効果」を見る。
 */
export function compareRefinance(
  debts: readonly Debt[],
  monthlyBudgetYen: number,
  refinancedAnnualRate: number,
  options: SimulateOptions & { strategy?: RepaymentStrategy | undefined } = {},
): {
  original: PayoffSummary;
  refinanced: PayoffSummary;
  savedInterestYen: number;
  shortenedMonths: number;
} {
  const strategy = options.strategy ?? 'avalanche';
  const original = summarizePayoff(
    simulateTotalPayoff(debts, { monthlyBudgetYen, strategy }, options),
  );
  const refinanced = summarizePayoff(
    simulateTotalPayoff(
      withRefinancedRate(debts, refinancedAnnualRate),
      { monthlyBudgetYen, strategy },
      options,
    ),
  );

  return {
    original,
    refinanced,
    savedInterestYen: original.totalInterestYen - refinanced.totalInterestYen,
    shortenedMonths: original.months - refinanced.months,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * 充当順に並べ替える(T-12、`simulateTotalPayoff()` から分離)。
 * SQL 側の ORDER BY と一致させること。
 *   avalanche : 金利降順(総利息が最小になる)
 *   snowball  : 残高昇順(1件目が早く消える)
 * どちらも金利・初期残高は期間中に順位が入れ替わらないため、最初に一度だけ並べる。
 */
function orderDebtsForStrategy(
  debts: readonly Debt[],
  strategy: RepaymentStrategy,
): readonly Debt[] {
  return [...debts]
    .filter((d) => d.balanceYen > 0)
    .sort((a, b) => {
      if (strategy === 'snowball') {
        if (a.balanceYen !== b.balanceYen) return a.balanceYen - b.balanceYen;
      } else if (a.annualRate !== b.annualRate) {
        return b.annualRate - a.annualRate;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * 利息を計上して残高に加える(T-12)。`balances` を直接書き換え、
 * 計上した利息合計を返す。`ordered` と `balances` は同じ添字で対応する。
 */
function accrueInterest(balances: number[], ordered: readonly Debt[]): number {
  let interestTotal = 0;
  for (let k = 0; k < balances.length; k += 1) {
    const balance = balances[k]!;
    if (balance > 0) {
      const interest = monthlyInterest(balance, ordered[k]!.annualRate);
      balances[k] = balance + interest;
      interestTotal += interest;
    }
  }
  return interestTotal;
}

/**
 * 予算を `balances` の先頭(充当順)から順に充てる(T-12)。
 * `capFor(k)` は k 件目に充てられる上限(最低返済額など)。省略時は
 * 残高と予算だけが上限になる(余剰の充当で使う)。
 */
function applyBudget(
  balances: number[],
  budget: number,
  capFor: (index: number) => number = () => Infinity,
): { paidYen: number; remainingBudget: number } {
  let paidYen = 0;
  for (let k = 0; k < balances.length && budget > 0; k += 1) {
    const balance = balances[k]!;
    if (balance > 0) {
      const pay = Math.min(capFor(k), balance, budget);
      balances[k] = balance - pay;
      budget -= pay;
      paidYen += pay;
    }
  }
  return { paidYen, remainingBudget: budget };
}

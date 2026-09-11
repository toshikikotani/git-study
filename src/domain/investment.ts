/**
 * 投資額の自動算出(FR-50, FR-52)。
 *
 * 「今月いくら投資に回すか」を毎回考えなくて済むようにする。返済目標額に
 * 一定比率を掛けるだけの単純な計算だが、判断を事前ルールに移す(設計原則4)
 * という本システムの考え方そのものがここに表れる。
 *
 * ── 高リスク枠について(FR-52) ────────────────────────────────
 * 完済前は投資総額の全額をインデックス枠に入れる。高リスク投資は
 * 「負債が無くなって初めて許される余力」という位置づけであり、
 * `isHighRiskUnlocked` が立って初めて `highRiskAllocationRatio` の分だけ
 * 高リスク枠に回す。この判定はここでは行わない(呼び出し側が
 * app_settings.is_high_risk_unlocked を渡すだけ)。
 */

export type InvestmentPlanInput = {
  /** app_settings.monthly_repayment_target_yen。 */
  monthlyRepaymentTargetYen: number;
  /** app_settings.investment_ratio_of_repayment(0〜1)。既定 0.2(2割)。 */
  investmentRatioOfRepayment: number;
  /** app_settings.is_high_risk_unlocked。完済前は常に false。 */
  isHighRiskUnlocked: boolean;
  /** app_settings.high_risk_allocation_ratio(0〜1)。既定 0.3(3割)。 */
  highRiskAllocationRatio: number;
};

export type InvestmentPlan = {
  /** 今月の投資総額(円)。 */
  totalYen: number;
  /** インデックス枠(円)。高リスク枠解禁前はここに全額入る。 */
  indexYen: number;
  /** 高リスク枠(円)。解禁前は常に 0。 */
  highRiskYen: number;
};

export function computeInvestmentPlan(input: InvestmentPlanInput): InvestmentPlan {
  const totalYen = Math.round(input.monthlyRepaymentTargetYen * input.investmentRatioOfRepayment);

  if (!input.isHighRiskUnlocked) {
    return { totalYen, indexYen: totalYen, highRiskYen: 0 };
  }

  const highRiskYen = Math.round(totalYen * input.highRiskAllocationRatio);
  return { totalYen, indexYen: totalYen - highRiskYen, highRiskYen };
}

/** debts.status(M7-3)。domain 層は features/debts/store.ts に依存しないため独自に持つ。 */
export type DebtLifecycleStatus = 'active' | 'paid_off' | 'refinanced' | 'closed';

/**
 * 全負債が完済したか(FR-52、高リスク枠解禁のトリガー)。
 *
 * 一度も負債を登録していない(debts が空)状態は「完済」に含めない。
 * 完済という節目は、返すべき負債があった上でこそ成立する。
 *
 * 'active' 以外(paid_off・refinanced・closed)はどれも「もう返済負担として
 * 残っていない」状態を意味する:refinanced は新しい負債へ移行済み(その新しい
 * 負債自体が active として別途カウントされる)、closed は誤登録の無効化。
 * そのため 'active' が1件も無いことだけを見れば足りる。
 */
export function isFullyPaidOff(debts: readonly { status: DebtLifecycleStatus }[]): boolean {
  if (debts.length === 0) return false;
  return debts.every((debt) => debt.status !== 'active');
}

export class InvestmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvestmentError';
  }
}

/** 拠出額(investment_contributions.amount_yen)。`ck_contributions_amount` に合わせ1円以上。 */
export function assertContributionAmountYen(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvestmentError(`拠出額は1円以上の整数で指定してください: ${value}`);
  }
  return value;
}

/** 残高(investment_snapshots.market_value_yen)。`ck_snapshots_value` に合わせ0円以上。 */
export function assertSnapshotValueYen(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvestmentError(`残高は0円以上の整数で指定してください: ${value}`);
  }
  return value;
}

/** 取得額(investment_snapshots.cost_basis_yen)。未入力は null、指定するなら0円以上。 */
export function assertSnapshotCostBasisYen(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new InvestmentError(`取得額は0円以上の整数で指定してください: ${value}`);
  }
  return value;
}

/** 商品名。空文字・空白のみは拒否する(残高の「同じ商品」判定のキーになるため必須)。 */
export function assertProductName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new InvestmentError('商品名を入力してください');
  }
  return trimmed;
}

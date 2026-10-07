/**
 * 投資額の自動算出(FR-50, FR-52)。
 *
 * 「今月いくら投資に回すか」を毎回考えなくて済むようにする。毎月の貯金目標に
 * 一定比率を掛けるだけの単純な計算だが、判断を事前ルールに移す(設計原則4)
 * という本システムの考え方そのものがここに表れる。
 *
 * ── 高リスク枠について(FR-52) ────────────────────────────────
 * ふだんは投資総額の全額をインデックス枠に入れる。本人が設定で高リスク枠を
 * 使うと決めたとき(`isHighRiskUnlocked`)だけ、`highRiskAllocationRatio` の分を
 * 高リスク枠に回す。以前は全負債の完済で自動で切り替えていたが、借金をなくした
 * (ADR-080)ので本人の切り替えにした。
 */

import { AppError } from '@/lib/errors';

export type InvestmentPlanInput = {
  /** app_settings.monthly_savings_target_yen。 */
  monthlySavingsTargetYen: number;
  /** app_settings.investment_ratio_of_savings(0〜1)。既定 0.2(2割)。 */
  investmentRatioOfSavings: number;
  /** app_settings.is_high_risk_unlocked。 */
  isHighRiskUnlocked: boolean;
  /** app_settings.high_risk_allocation_ratio(0〜1)。既定 0.3(3割)。 */
  highRiskAllocationRatio: number;
};

export type InvestmentPlan = {
  /** 今月の投資総額(円)。 */
  totalYen: number;
  /** インデックス枠(円)。高リスク枠を使わないときはここに全額入る。 */
  indexYen: number;
  /** 高リスク枠(円)。使わないときは 0。 */
  highRiskYen: number;
};

export function computeInvestmentPlan(input: InvestmentPlanInput): InvestmentPlan {
  const totalYen = Math.round(input.monthlySavingsTargetYen * input.investmentRatioOfSavings);

  if (!input.isHighRiskUnlocked) {
    return { totalYen, indexYen: totalYen, highRiskYen: 0 };
  }

  const highRiskYen = Math.round(totalYen * input.highRiskAllocationRatio);
  return { totalYen, indexYen: totalYen - highRiskYen, highRiskYen };
}

export class InvestmentError extends AppError {}

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

/**
 * 資産推移グラフの元になる、投資評価額の時点集計(P6-3)。
 *
 * investment_snapshots は商品ごとに本人が好きなタイミングで残高を記録する
 * (ux_snapshots_user_account_product_date が (account, product, 日付) 単位)。
 * ある時点の「投資評価額」は、その時点以前で商品ごとに最も新しい記録を
 * 1件選び、それらを合算したもの(まだ記録が無い・記録前の商品は0として
 * 無視する。本人が全商品を毎回律儀に更新するとは限らないため)。
 */
export type InvestmentSnapshotPoint = {
  /** 「同じ商品」を識別するキー(accountId + productName の組)。 */
  productKey: string;
  asOf: string;
  marketValueYen: number;
};

export function totalInvestmentValueAsOf(
  snapshots: readonly InvestmentSnapshotPoint[],
  asOf: string,
): number {
  const latestByProduct = new Map<string, InvestmentSnapshotPoint>();
  for (const snapshot of snapshots) {
    if (snapshot.asOf > asOf) continue;
    const current = latestByProduct.get(snapshot.productKey);
    if (!current || snapshot.asOf > current.asOf) {
      latestByProduct.set(snapshot.productKey, snapshot);
    }
  }
  return [...latestByProduct.values()].reduce((sum, s) => sum + s.marketValueYen, 0);
}

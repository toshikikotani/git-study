/**
 * 「使える残額」の計算(FR-14)。
 *
 * ホーム画面に出る2つの数字の元。ここが狂うと、本人は残額表示を信じなくなり、
 * 画面を開く理由が消える(FR-60)。SQL の v_current_month_budget_status と
 * 同じ結果になること。
 *
 * 集計から外すもの:
 *   - 口座間振替(is_transfer):お金が減っていないため
 *   - review_status = 'ignored':本人が対象外と判断した明細
 *   - 収入(amount_yen > 0):支出の消化率に混ぜない
 */

import { assertYen } from './money';

/** 集計対象の明細。transactions のうち判定に使う部分だけ。 */
export type BudgetTransaction = {
  categoryId: string | null;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
  isTransfer: boolean;
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
};

export type CategoryBudget = {
  categoryId: string;
  /** 予算未設定なら null。上限のないジャンルもある。 */
  budgetYen: number | null;
  /** 前月からの繰越(±)。 */
  carryOverYen: number;
};

export type BudgetStatus = {
  categoryId: string;
  budgetYen: number | null;
  carryOverYen: number;
  /** 使った額。正の数で返す(表示のたびに符号を反転させないため)。 */
  spentYen: number;
  /** 残額。予算未設定なら null。マイナスもありうる(超過)。 */
  remainingYen: number | null;
  /** 消化率。予算が 0 または未設定なら null。 */
  usageRatio: number | null;
  transactionCount: number;
};

/**
 * カテゴリごとの当月の消化状況を出す。
 *
 * 予算が定義されているカテゴリは、支出が1件も無くても結果に含める。
 * 「まだ使っていない」ことも本人が見たい情報であり、行が消えると
 * 枠が存在しないのか使っていないのかが区別できない。
 */
export function summarizeBudgets(
  budgets: readonly CategoryBudget[],
  transactions: readonly BudgetTransaction[],
): BudgetStatus[] {
  const spentByCategory = new Map<string, { spentYen: number; count: number }>();

  for (const tx of transactions) {
    if (!isCountable(tx)) continue;
    if (tx.categoryId === null) continue;

    const entry = spentByCategory.get(tx.categoryId) ?? { spentYen: 0, count: 0 };
    // 支出は負で入っている。使った額として正に反転する。
    entry.spentYen += -tx.amountYen;
    entry.count += 1;
    spentByCategory.set(tx.categoryId, entry);
  }

  return budgets.map((budget) => {
    const found = spentByCategory.get(budget.categoryId);
    const spentYen = found?.spentYen ?? 0;
    return {
      categoryId: budget.categoryId,
      budgetYen: budget.budgetYen,
      carryOverYen: budget.carryOverYen,
      spentYen,
      remainingYen:
        budget.budgetYen === null ? null : budget.budgetYen + budget.carryOverYen - spentYen,
      usageRatio:
        budget.budgetYen !== null && budget.budgetYen > 0 ? spentYen / budget.budgetYen : null,
      transactionCount: found?.count ?? 0,
    };
  });
}

/** 1カテゴリ分だけを出す。ホームに並べる枠(categories.show_on_home)で使う。 */
export function budgetStatusFor(
  budget: CategoryBudget,
  transactions: readonly BudgetTransaction[],
): BudgetStatus {
  const [status] = summarizeBudgets([budget], transactions);
  return status!;
}

/**
 * FR-20:浪費カテゴリが月予算の閾値(既定 70%)に達したか。
 *
 * 100% 到達では遅い。「まだ使える」うちに知らせることで、
 * 使い切ってから責めるのではなく、判断の余地がある状態で見せる(設計原則3)。
 */
export function hasReachedAlertThreshold(status: BudgetStatus, threshold: number): boolean {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new RangeError(`閾値は 0 より大きく 1 以下の小数で指定してください: ${threshold}`);
  }
  return status.usageRatio !== null && status.usageRatio >= threshold;
}

/**
 * 枠の状態。メーターの色と、添えるラベルを決める。
 *
 *   normal    まだ余裕がある
 *   attention 閾値に達した(FR-20。既定 70%)
 *   over      予算を超えた
 *
 * ADR-057より前は「聖域カテゴリ」だけ70%到達の警告色を出さない例外が
 * あったが、category_kind(生活費・浪費・聖域…)の廃止に伴い削除した。
 * 全てのジャンルを同列に扱う(本人が特定のジャンルに警告を出したくなければ、
 * そのジャンルの予算を未設定のままにすればよい——予算が無ければ
 * usageRatio 自体が null になり、attention にはならない)。
 */
export type BudgetTone = 'normal' | 'attention' | 'over';

/** 枠の状態を判定する。超過は常に表示する(設計原則3「叱らず見せる」)。 */
export function budgetTone(status: BudgetStatus, threshold = 0.7): BudgetTone {
  if (status.remainingYen !== null && status.remainingYen < 0) return 'over';
  if (status.usageRatio !== null && status.usageRatio >= threshold) return 'attention';
  return 'normal';
}

/**
 * 収支の合計。振替と対象外を除いた実質の増減を返す。
 * 支出が負のまま返す(ADR-008 の符号規約を画面の手前まで保つ)。
 */
export function netAmountYen(transactions: readonly BudgetTransaction[]): number {
  return assertYen(
    transactions.reduce((acc, tx) => (isCountable(tx) ? acc + tx.amountYen : acc), 0),
    '収支合計',
  );
}

/** 当月の支出合計(正の数)。 */
export function totalSpentYen(transactions: readonly BudgetTransaction[]): number {
  return transactions.reduce(
    (acc, tx) => (isCountable(tx) && tx.amountYen < 0 ? acc - tx.amountYen : acc),
    0,
  );
}

/**
 * 集計に数えるべき明細か。
 * 口座間振替はお金が減っていないため除く。本人が対象外とした明細も除く。
 *
 * domain/spending.ts(P6-2)の月次集計でも同じ判定を使うため export する
 * (「収支の対象外」の定義を1箇所に保つ)。
 */
export function isCountable(tx: BudgetTransaction): boolean {
  return !tx.isTransfer && tx.reviewStatus !== 'ignored';
}

/**
 * 進捗ゲージ(貯金目標・予算)に刻むマイルストーン。到達を祝うための節目。
 *
 * `features/home/summary.ts` は `next/headers` に依存する `createClient()` を
 * 使うため、そこにこの定数を置くと `Meter`(Client Component)がそれを
 * import した時点でクライアントバンドルに `next/headers` が引き込まれてしまう
 * (T-7 で発見した同種の問題)。ここ(DB にもネットワークにも触れない
 * domain 層)に置くことで、サーバー・クライアントどちらからも安全に使える。
 */
export const MILESTONES = [0.25, 0.5, 0.75, 1] as const;

/** まだ到達していない最初のマイルストーン。全て達成済みなら null。 */
export function nextMilestone(progressRatio: number): number | null {
  return MILESTONES.find((m) => progressRatio < m) ?? null;
}

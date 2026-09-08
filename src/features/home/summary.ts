/**
 * ホーム画面に出す3つの数字(FR-03, FR-14, FR-61)。
 *
 *   1. 完済まで残り日数 / 残り金額
 *   2〜3. 本人が選んだカテゴリの残額(初期値は生活費と聖域)
 *
 * 数字は3個までに絞る。増やしたくなったら下層画面へ置くこと。
 * 「見るべきものが3つしかない」ことが、開き続けられる条件になる(FR-61)。
 *
 * ── 表示名をここに書かないこと(ADR-016)────────────────────────
 * どの枠を出すか(categories.show_on_home)も、何という名前で出すか
 * (categories.name)も、本人が変更できる。コードに日本語ラベルを
 * 直書きすると、本人が改名しても画面が変わらない。
 * ラベルは必ずデータから来る。分岐が要るときは code か kind を見る。
 *
 * ── データ源について(M0-3 以降)────────────────────────────
 * Supabase から実データを読む。RLS が本人の行だけに絞るので、
 * ここでは user_id を意識しない(ADR-011)。
 */

import { budgetStatusFor, type BudgetTransaction, type CategoryBudget } from '@/domain/budget';
import { simulateTotalPayoff, summarizePayoff, type Debt } from '@/domain/payoff';
import { listDebts, toPayoffDebt } from '@/features/debts/store';
import { getAppSettings } from '@/features/settings/store';
import { daysBetween, monthStartJst, todayJst, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

/** ホームに並ぶ残額タイル1枚分。 */
export type HomeBudgetTile = {
  categoryId: string;
  /** 分岐に使う不変の識別子。表示には使わない。 */
  code: string;
  /** 画面に出す名前。本人が変更できる(categories.name)。 */
  label: string;
  budgetYen: number | null;
  spentYen: number;
  /** 予算未設定なら null。マイナスもありうる(超過)。 */
  remainingYen: number | null;
  usageRatio: number | null;
};

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
    /**
     * 今月これまでに減った残債(円、正の数)。
     *
     * 残高のスナップショットだけでは「進んでいる」ことが伝わらない。
     * 負債返済アプリが例外なく持つ正のフィードバックはここから来る。
     * 実績が無い月は 0。
     */
    reducedThisMonthYen: number;
    /** 次に到達するマイルストーン(0.25 / 0.5 / 0.75 / 1)。達成済みなら null。 */
    nextMilestone: number | null;
  };
  /** show_on_home が立っているカテゴリ。FR-61 のため最大2件に切る。 */
  tiles: HomeBudgetTile[];
};

/** ホームに出す枠の上限。完済カウントダウンと合わせて数字3個(FR-61)。 */
export const MAX_HOME_TILES = 2;

/** categories の1行のうち、ホーム表示に必要な部分。 */
export type HomeCategory = CategoryBudget & {
  name: string;
  sortOrder: number;
  showOnHome: boolean;
  isActive: boolean;
};

/**
 * ホームに出す残額タイルを組み立てる。
 *
 * 対象と並び順は本人の設定(show_on_home / sort_order)で決まる。
 * ここでカテゴリを名指ししないことが、本人が枠を選び直せることの実体。
 */
export function buildHomeTiles(
  categories: readonly HomeCategory[],
  transactions: readonly BudgetTransaction[],
  limit: number = MAX_HOME_TILES,
): HomeBudgetTile[] {
  return categories
    .filter((category) => category.showOnHome && category.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map((category) => {
      const status = budgetStatusFor(category, transactions);
      return {
        categoryId: category.categoryId,
        code: category.code,
        label: category.name,
        budgetYen: status.budgetYen,
        spentYen: status.spentYen,
        remainingYen: status.remainingYen,
        usageRatio: status.usageRatio,
      };
    });
}

export type PayoffInput = {
  debts: readonly Debt[];
  monthlyBudgetYen: number;
  /** 当初の負債総額。進捗ゲージの分母に使う。 */
  originalTotalYen: number;
  isEstimated: boolean;
  /** 今月これまでの返済実績(円、正の数)。 */
  reducedThisMonthYen: number;
};

/** 進捗ゲージに刻むマイルストーン。到達を祝うための節目。 */
export const MILESTONES = [0.25, 0.5, 0.75, 1] as const;

/** まだ到達していない最初のマイルストーン。全て達成済みなら null。 */
export function nextMilestone(progressRatio: number): number | null {
  return MILESTONES.find((m) => progressRatio < m) ?? null;
}

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
      reducedThisMonthYen: input.reducedThisMonthYen,
      nextMilestone: null,
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
    reducedThisMonthYen: input.reducedThisMonthYen,
    nextMilestone: nextMilestone(progressRatio),
  };
}

export async function loadHomeSummary(now: Date = new Date()): Promise<HomeSummary> {
  const [payoffInput, categories] = await Promise.all([
    loadPayoffInput(now),
    listHomeCategories(now),
  ]);
  const transactions = await listMonthTransactions(
    categories.map((c) => c.categoryId),
    now,
  );

  return {
    payoff: computePayoffSummary(payoffInput, now),
    tiles: buildHomeTiles(categories, transactions),
  };
}

/** 完済シミュレーションの入力を組み立てる。debts / app_settings / debt_payments を読む。 */
async function loadPayoffInput(now: Date): Promise<PayoffInput> {
  const [rows, settings, reducedThisMonthYen] = await Promise.all([
    listDebts(),
    getAppSettings(),
    loadReducedThisMonthYen(now),
  ]);

  return {
    debts: rows.map(toPayoffDebt),
    monthlyBudgetYen: settings.monthlyRepaymentTargetYen,
    // 当初元本が未入力の負債は、現在残高をそのまま分母に使う
    // (その負債単体の進捗は 0% から始まり、実際に減った分だけ動く)。
    originalTotalYen: rows.reduce(
      (acc, r) => acc + (r.originalPrincipalYen ?? r.currentBalanceYen),
      0,
    ),
    isEstimated: rows.some((r) => r.isEstimated),
    reducedThisMonthYen,
  };
}

/** 今月の debt_payments 合計(元本部分)。M1-6 の返済記録が無ければ 0。 */
async function loadReducedThisMonthYen(now: Date): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('debt_payments')
    .select('principal_yen, amount_yen')
    .gte('paid_on', monthStartJst(0, now));
  if (error) throw new Error(`返済実績を取得できませんでした: ${error.message}`);
  // 元本・利息の内訳が無い記録は、合計額をそのまま元本減少として扱う。
  return data.reduce((acc, p) => acc + (p.principal_yen ?? p.amount_yen), 0);
}

/**
 * ホームに出す候補カテゴリ(show_on_home = true)と、当月の予算額を組み立てる。
 * budgets に当月の行が無いカテゴリは、categories.default_monthly_budget_yen を使う
 * (毎月の予算行を作る仕組みはまだ無いため)。
 */
async function listHomeCategories(now: Date): Promise<HomeCategory[]> {
  const supabase = await createClient();
  const { data: categories, error } = await supabase
    .from('categories')
    .select('id, code, name, default_monthly_budget_yen, sort_order, show_on_home, is_active')
    .eq('show_on_home', true)
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw new Error(`カテゴリを取得できませんでした: ${error.message}`);
  if (categories.length === 0) return [];

  const categoryIds = categories.map((c) => c.id);
  const { data: budgets, error: budgetError } = await supabase
    .from('budgets')
    .select('category_id, amount_yen, carry_over_yen')
    .eq('month', monthStartJst(0, now))
    .in('category_id', categoryIds);
  if (budgetError) throw new Error(`予算を取得できませんでした: ${budgetError.message}`);

  const budgetByCategory = new Map(budgets.map((b) => [b.category_id, b]));

  return categories.map((c) => {
    const budget = budgetByCategory.get(c.id);
    return {
      categoryId: c.id,
      code: c.code,
      name: c.name,
      budgetYen: budget?.amount_yen ?? c.default_monthly_budget_yen,
      carryOverYen: budget?.carry_over_yen ?? 0,
      sortOrder: c.sort_order,
      showOnHome: c.show_on_home,
      isActive: c.is_active,
    };
  });
}

/** 当月・指定カテゴリの明細。集計から外すもの(振替・対象外)は domain/budget.ts 側で判定する。 */
async function listMonthTransactions(
  categoryIds: readonly string[],
  now: Date,
): Promise<BudgetTransaction[]> {
  if (categoryIds.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transactions')
    .select('category_id, amount_yen, is_transfer, review_status')
    .in('category_id', categoryIds)
    .gte('occurred_on', monthStartJst(0, now))
    .lt('occurred_on', monthStartJst(1, now));
  if (error) throw new Error(`明細を取得できませんでした: ${error.message}`);

  return data.map((t) => ({
    categoryId: t.category_id,
    amountYen: t.amount_yen,
    isTransfer: t.is_transfer,
    reviewStatus: t.review_status,
  }));
}

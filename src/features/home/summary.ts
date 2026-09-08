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
 * ── データ源について ────────────────────────────────────────
 * 現在は ADR-006 の仮置き値を返す。Supabase 接続(M0-2/M0-3)が済んだら
 * loadHomeSummary() の中身だけを差し替える。呼び出し側と表示は変わらない。
 */

import { budgetStatusFor, type BudgetTransaction, type CategoryBudget } from '@/domain/budget';
import { simulateTotalPayoff, summarizePayoff, type Debt } from '@/domain/payoff';
import { daysBetween, monthStartJst, todayJst, type DateOnly } from '@/lib/date';

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

/**
 * DB の categories 行の代わり。M0-3 で Supabase 読み出しに置き換わって消える。
 * ここにある name は seed_defaults の初期値を写しただけで、本人が改名すれば
 * DB 側の値が使われる。表示名がコードに残るのはこの仮置きの間だけ(ADR-016)。
 */
const PLACEHOLDER_CATEGORIES: HomeCategory[] = [
  {
    categoryId: 'cat-living',
    code: 'living',
    name: '生活費',
    budgetYen: 60_000,
    carryOverYen: 0,
    sortOrder: 20,
    showOnHome: true,
    isActive: true,
  },
  {
    categoryId: 'cat-sanctuary',
    code: 'sanctuary',
    name: '聖域',
    budgetYen: 40_000,
    carryOverYen: 0,
    sortOrder: 30,
    showOnHome: true,
    isActive: true,
  },
];

export async function loadHomeSummary(now: Date = new Date()): Promise<HomeSummary> {
  // TODO(M0-3): Supabase から debts / app_settings / categories / transactions を読む
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
    tiles: buildHomeTiles(PLACEHOLDER_CATEGORIES, []),
  };
}

/**
 * カテゴリ別・月別の支出集計(P6-2、/reports の元データ)。
 *
 * 「使える残額」(domain/budget.ts)とは別の切り口:予算の有無に関係なく、
 * 全カテゴリの実際の支出額を月ごとに並べる。集計対象の定義
 * (振替・ignored を除く、収入を含めない)は domain/budget.ts の
 * isCountable() と揃える(同じ「支出」の定義を2箇所で別々に決めない)。
 */

import type { AccumulationTransaction } from '@/domain/accumulation';
import { isCountable, type BudgetTransaction } from '@/domain/budget';
import type { DateOnly } from '@/lib/date';

export type SpendingTransaction = BudgetTransaction & {
  occurredOn: DateOnly;
};

export type MonthlyCategorySpend = {
  monthKey: string;
  categoryId: string;
  categoryName: string;
  spentYen: number;
};

/**
 * 指定した月(monthKeys, 'YYYY-MM' の配列)× カテゴリの全組み合わせについて、
 * 支出額(正の数)を返す。取引が1件も無い月・カテゴリの組も 0 で含める
 * (budget.ts の summarizeBudgets と同じ考え方。行が消えると「未入力」なのか
 * 「本当に使っていない」のかが画面から区別できない)。
 *
 * 収入(amountYen > 0)は支出の集計に混ぜない。
 */
export function summarizeMonthlySpendByCategory(
  categories: readonly { id: string; name: string }[],
  transactions: readonly SpendingTransaction[],
  monthKeys: readonly string[],
): MonthlyCategorySpend[] {
  const spentByKey = new Map<string, number>();

  for (const tx of transactions) {
    if (!isCountable(tx) || tx.categoryId === null || tx.amountYen >= 0) continue;
    const monthKey = tx.occurredOn.slice(0, 7);
    const key = `${monthKey}:${tx.categoryId}`;
    spentByKey.set(key, (spentByKey.get(key) ?? 0) - tx.amountYen);
  }

  return monthKeys.flatMap((monthKey) =>
    categories.map((category) => ({
      monthKey,
      categoryId: category.id,
      categoryName: category.name,
      spentYen: spentByKey.get(`${monthKey}:${category.id}`) ?? 0,
    })),
  );
}

export type MonthlyIncomeExpense = {
  monthKey: string;
  incomeYen: number;
  /** 正の数。 */
  expenseYen: number;
};

/**
 * 月ごとの収入・支出の合計(分析系拡充、本人発案)。
 *
 * summarizeMonthlySpendByCategory() と違い、**カテゴリ未設定の明細も含める**
 * (こちらは「収支の全体」を出す集計で、1円でも漏れると貯蓄率がずれる。
 * カテゴリ別の内訳を見たいときだけ categoryId が要る)。
 */
export function summarizeMonthlyIncomeExpense(
  transactions: readonly SpendingTransaction[],
  monthKeys: readonly string[],
): MonthlyIncomeExpense[] {
  const byMonth = new Map<string, { incomeYen: number; expenseYen: number }>();

  for (const tx of transactions) {
    if (!isCountable(tx)) continue;
    const monthKey = tx.occurredOn.slice(0, 7);
    const current = byMonth.get(monthKey) ?? { incomeYen: 0, expenseYen: 0 };
    if (tx.amountYen > 0) {
      current.incomeYen += tx.amountYen;
    } else {
      current.expenseYen += -tx.amountYen;
    }
    byMonth.set(monthKey, current);
  }

  return monthKeys.map((monthKey) => ({
    monthKey,
    incomeYen: byMonth.get(monthKey)?.incomeYen ?? 0,
    expenseYen: byMonth.get(monthKey)?.expenseYen ?? 0,
  }));
}

/** 貯蓄率。収入が0円の月は意味を持たないため null(0%と誤読させない)。 */
export function savingsRateOf(entry: MonthlyIncomeExpense): number | null {
  if (entry.incomeYen <= 0) return null;
  return (entry.incomeYen - entry.expenseYen) / entry.incomeYen;
}

export type MerchantSpend = {
  label: string;
  count: number;
  /** 正の数。 */
  totalYen: number;
};

/**
 * 店(摘要)ごとの支出を合計の大きい順に並べる(分析系拡充、本人発案)。
 *
 * domain/accumulation.ts の summarizeSmallSpends() と対になる切り口——
 * あちらは「1,000円未満の小口がどれだけ積もっているか」、こちらは金額を
 * 絞らず「結局どこに一番使っているか」(家賃・保険のような大口の定期支払いも
 * 含めた全体ランキング)。分割(transaction_splits)を展開しない理由も同じ
 * (集計軸は店であり、1回の買い物を複数カテゴリへ按分しても店から見た支払いは
 * 1回・1金額のまま)。表記ゆれの正規化も同程度(空白除去+小文字化、表示は
 * 元の表記)。
 */
export function rankMerchantsBySpend(
  transactions: readonly AccumulationTransaction[],
  limit = 10,
): MerchantSpend[] {
  const groups = new Map<string, { label: string; count: number; totalYen: number }>();

  for (const tx of transactions) {
    if (!isCountable(tx) || tx.amountYen >= 0) continue;

    const label = tx.label.trim();
    if (label === '') continue;

    const key = normalizeLabel(label);
    const current = groups.get(key);
    groups.set(key, {
      label: current?.label ?? label,
      count: (current?.count ?? 0) + 1,
      totalYen: (current?.totalYen ?? 0) + -tx.amountYen,
    });
  }

  return [...groups.values()].sort((a, b) => b.totalYen - a.totalYen).slice(0, limit);
}

function normalizeLabel(label: string): string {
  return label.replace(/[\s　]/g, '').toLowerCase();
}

/**
 * 今のペースが続いた場合の、今月の着地見込み額(家計簿の「予測」、本人発案)。
 *
 * domain/accumulation.ts の annualizedPaceYen() と同じ考え方(1日あたりに
 * 均してから日数を掛ける)だが、あちらは「1年続いたら」、こちらは
 * 「今月の残り日数まで」を見積もる——月初の数日だけで年換算すると
 * 大きく振れるのに対し、月内の着地予測は経過日数の割合がそのまま効くため
 * 実用上はこちらの方が早い時期から参考になる。
 */
export function projectedMonthTotalYen(
  spentSoFarYen: number,
  elapsedDays: number,
  totalDaysInMonth: number,
): number {
  if (elapsedDays <= 0) return spentSoFarYen;
  return Math.round((spentSoFarYen / elapsedDays) * totalDaysInMonth);
}

/**
 * 「ちりつも」画面のデータアクセス(本人発案)。
 *
 * 判断(何をどう積み上げるか)は domain/accumulation.ts の純粋関数、
 * 完済への換算は domain/payoff.ts の payoffImpactOfExtraPayment() に任せ、
 * ここでは「DB から何を読むか」だけを担う。新しいテーブルは持たない
 * (毎回 transactions を集計し直す。features/reports/store.ts と同じ考え方)。
 */

import {
  annualizedPaceYen,
  compareToPreviousMonthPace,
  summarizeNoSpendDays,
  summarizeSmallSpends,
  SMALL_SPEND_THRESHOLD_YEN,
  type AccumulationTransaction,
  type NoSpendSummary,
  type PaceComparison,
  type SmallSpendGroup,
} from '@/domain/accumulation';
import { payoffImpactOfExtraPayment } from '@/domain/payoff';
import { listDebts, toPayoffDebt } from '@/features/debts/store';
import { getAppSettings } from '@/features/settings/store';
import { addMonths, nthDayOfMonth, todayJst, type DateOnly } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

export class AccumulationStoreError extends AppError {}

/** 小口の山に並べる店の数。多すぎると「山」に見えない。 */
const SMALL_SPEND_LIMIT = 8;

export type AccumulationView = {
  /** 今月(月初〜今日)。 */
  period: { from: DateOnly; to: DateOnly };
  thresholdYen: number;
  smallSpends: SmallSpendGroup[];
  /** 今月の小口支出の合計(正の数)。 */
  smallSpendTotalYen: number;
  /** 今のペースが1年続いた場合の小口支出(正の数)。 */
  smallSpendAnnualizedYen: number;
  noSpend: NoSpendSummary;
  pace: PaceComparison;
  /**
   * 小口支出を丸ごと返済に回した場合の効果。
   * 債務が無い・返済目標が未設定なら null(画面では出さない)。
   */
  payoffImpact: { shortenedMonths: number; savedInterestYen: number } | null;
};

export async function loadAccumulationView(now: Date = new Date()): Promise<AccumulationView> {
  const today = todayJst(now);
  const thisMonthStart = nthDayOfMonth(today, 1);
  // 前月同日比のため、先月の月初まで遡って読む。
  const rangeStart = nthDayOfMonth(addMonths(today, -1), 1);

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('transactions')
    .select('merchant_name, description, amount_yen, occurred_on, is_transfer, review_status')
    .gte('occurred_on', rangeStart)
    .lte('occurred_on', today);
  if (error) throw new AccumulationStoreError(`明細を取得できませんでした: ${error.message}`);

  const transactions: AccumulationTransaction[] = rows.map((row) => ({
    categoryId: null,
    amountYen: row.amount_yen,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
    occurredOn: row.occurred_on,
    label: row.merchant_name ?? row.description,
  }));

  const thisMonth = transactions.filter((tx) => tx.occurredOn >= thisMonthStart);
  const allSmallSpends = summarizeSmallSpends(thisMonth);
  const smallSpendTotalYen = allSmallSpends.reduce((acc, group) => acc + group.totalYen, 0);
  const noSpend = summarizeNoSpendDays(thisMonth, { from: thisMonthStart, to: today });
  const smallSpendAnnualizedYen = annualizedPaceYen(smallSpendTotalYen, noSpend.elapsedDays);

  return {
    period: { from: thisMonthStart, to: today },
    thresholdYen: SMALL_SPEND_THRESHOLD_YEN,
    smallSpends: allSmallSpends.slice(0, SMALL_SPEND_LIMIT),
    smallSpendTotalYen,
    smallSpendAnnualizedYen,
    noSpend,
    pace: compareToPreviousMonthPace(transactions, today),
    payoffImpact: await loadPayoffImpact(Math.round(smallSpendAnnualizedYen / 12)),
  };
}

/**
 * 小口支出の月あたり相当額をそのまま返済に上乗せした場合の効果。
 *
 * 債務・設定の読み出しに失敗しても「ちりつも」画面自体は落とさない
 * (この換算はあくまで添え物で、小口の山そのものは単独で意味を持つ)。
 */
async function loadPayoffImpact(
  extraMonthlyYen: number,
): Promise<{ shortenedMonths: number; savedInterestYen: number } | null> {
  if (extraMonthlyYen <= 0) return null;

  try {
    const [debts, settings] = await Promise.all([listDebts(), getAppSettings()]);
    if (debts.length === 0 || settings.monthlyRepaymentTargetYen <= 0) return null;

    // app_settings は 'minimum'/'custom' も持ちうるが、ここで比べたいのは
    // 「今の返済額 vs 上乗せ後」であって戦略の違いではない。順序付けの
    // 2択(/debts のシミュレーションと同じ扱い)へ寄せる。
    const strategy = settings.repaymentStrategy === 'snowball' ? 'snowball' : 'avalanche';

    return payoffImpactOfExtraPayment(
      debts.map(toPayoffDebt),
      settings.monthlyRepaymentTargetYen,
      extraMonthlyYen,
      { strategy },
    );
  } catch {
    return null;
  }
}

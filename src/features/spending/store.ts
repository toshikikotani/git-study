/**
 * 家計簿(/spending)のデータアクセス(本人発案:「普通の家計簿」への作り直し)。
 *
 * 元は「ちりつも」(小口支出の山)しか無く、収支の全体像・ジャンル別の内訳・
 * 今月の明細・予測が無かった。明細は entries.ts が読み、集計は domain/ledger.ts
 * の summarizeLedger()(views.ts 経由)が唯一の窓口。ここでは「どの期間を読み、
 * どの画面向けに組み立てるか」だけを持つ。月次のスナップショットは保存しない
 * (features/reports/store.ts と同じ考え方。毎回 transactions を集計し直す)。
 */

import { monthRange, summarizeLedger } from '@/domain/ledger';
import { projectedMonthTotalYen } from '@/domain/spending';
import { addMonths, daysBetween, nthDayOfMonth, todayJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { countRecordedDays } from '@/domain/summary-rules';
import { createClient } from '@/lib/supabase/server';
import { loadLedgerTransactions } from './entries';
import { attachThumbnails } from './thumbnails';
import { buildLedgerViews, toLedgerEntries } from './views';
import type {
  GenreBreakdownRow,
  LedgerTransaction,
  MonthlyLedgerView,
  MonthTotals,
} from './ledger-types';

export type {
  GenreBreakdownRow,
  LedgerTransaction,
  MonthlyForecast,
  MonthlyLedgerView,
  MonthlyPace,
} from './ledger-types';

export class SpendingStoreError extends AppError {}

export async function loadMonthlyLedger(now: Date = new Date()): Promise<MonthlyLedgerView> {
  const today = todayJst(now);
  const monthKey = today.slice(0, 7);
  const thisMonth = monthRange(monthKey);
  // 先月同日比のため、先月の月初まで遡って読む。未来日(予定)も今月末まで読む。
  const lastMonthStart = nthDayOfMonth(addMonths(today, -1), 1);

  const [loaded, firstRecordedOn] = await Promise.all([
    loadLedgerTransactions({ from: lastMonthStart, to: thisMonth.to }, today),
    loadFirstRecordedOn(today),
  ]);
  const { genres, transactions } = loaded;

  const views = buildLedgerViews({ genres, transactions, range: thisMonth, today });
  const entries = toLedgerEntries(transactions);

  const elapsedDays = daysBetween(thisMonth.from, today) + 1;
  const totalDaysInMonth = daysBetween(thisMonth.from, thisMonth.to) + 1;
  const budgetedGenres = genres.filter((g) => g.budget_yen !== null);
  const totalBudgetYen =
    budgetedGenres.length === 0
      ? null
      : budgetedGenres.reduce((acc, g) => acc + (g.budget_yen ?? 0), 0);

  const lastMonthSameDay = addMonths(today, -1);
  const lastMonthSameDayYen = summarizeLedger(
    entries,
    { from: lastMonthStart, to: lastMonthSameDay },
    today,
  ).spentYen;
  const { summary } = views;

  const recordedDaysThisMonth = countRecordedDays(
    [...summary.byDay.keys()].filter((d) => d >= thisMonth.from),
  );

  return {
    record: { firstRecordedOn, recordedDaysThisMonth },
    period: { from: thisMonth.from, to: today },
    totals: views.totals,
    totalSpentYen: summary.spentYen,
    totalIncomeYen: summary.incomeYen,
    genreBreakdown: views.genreBreakdown,
    transactions: await attachThumbnails(
      transactions.filter(
        (t) => t.occurredOn >= thisMonth.from && t.occurredOn <= thisMonth.to && isListed(t),
      ),
      loaded.batchIdByTransactionId,
    ),
    forecast: {
      elapsedDays,
      totalDaysInMonth,
      // 特別費は今後も同じ額で続くわけではないため、ペースの外挿から外して後から足す。
      projectedTotalYen:
        projectedMonthTotalYen(summary.paceSpentYen, elapsedDays, totalDaysInMonth) +
        summary.specialYen,
      totalBudgetYen,
    },
    pace: {
      dayOfMonth: elapsedDays,
      thisMonthToDateYen: summary.spentYen,
      lastMonthSameDayYen,
      differenceYen: summary.spentYen - lastMonthSameDayYen,
    },
    sourceTransactions: transactions,
    genreNames: new Map(genres.map((g) => [g.id, g.name])),
    loadedFrom: lastMonthStart,
    loadedTo: thisMonth.to,
  };
}

/** 一覧に出す明細(振替・対象外は出さない)。 */
function isListed(t: LedgerTransaction): boolean {
  return !t.isTransfer && t.reviewStatus !== 'ignored';
}

/**
 * カレンダー(家計簿トップ)で移動した月の、明細とジャンル別の内訳。
 * 今月と同じ buildLedgerViews で組み立てるため、過去・未来の月も今月と同じ
 * 見え方・同じ集計になる(収支の対象になるものだけ・品目から決めた代表ジャンル
 * 込み・収入も含む、新しい日付が先頭)。
 */
export async function loadCalendarMonth(
  monthStart: string,
  now: Date = new Date(),
): Promise<{
  transactions: LedgerTransaction[];
  genreBreakdown: GenreBreakdownRow[];
  totals: MonthTotals;
}> {
  const today = todayJst(now);
  const range = monthRange(monthStart.slice(0, 7));
  const loaded = await loadLedgerTransactions(range, today);
  const { genres, transactions } = loaded;
  const views = buildLedgerViews({ genres, transactions, range, today });
  return {
    transactions: await attachThumbnails(
      transactions.filter(isListed),
      loaded.batchIdByTransactionId,
    ),
    genreBreakdown: views.genreBreakdown,
    totals: views.totals,
  };
}

/** 最初の記録の日(今日まで)。1件も無ければ null。 */
async function loadFirstRecordedOn(today: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transactions')
    .select('occurred_on')
    .lte('occurred_on', today)
    .order('occurred_on', { ascending: true })
    .limit(1);
  if (error || data.length === 0) return null;
  return data[0]!.occurred_on;
}

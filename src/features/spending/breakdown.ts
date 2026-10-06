/**
 * 1か月分のジャンル別の内訳(家計簿の「ジャンル別の内訳」)を組み立てる。
 * DB にもネットワークにも触れない。今月(loadMonthlyLedger)とカレンダーで
 * 移動した過去・未来の月(loadCalendarMonth)が同じ結果になるよう、両方がここを使う。
 *
 * 数字は domain/ledger.ts の summarizeLedger() の byGenre をそのまま並べる
 * だけで、ここで足し算し直さない(ヘッダーの合計と必ず一致させるため)。
 */

import { budgetTone } from '@/domain/budget';
import { monthRange, summarizeLedger, type LedgerEntry, type LedgerSummary } from '@/domain/ledger';
import type { DateOnly } from '@/lib/date';
import type { GenreBreakdownRow } from './ledger-types';

export const UNCATEGORIZED_LABEL = '未分類';

/**
 * 枠の警告色は domain/budget.ts の budgetTone() が担う判断(ホームの予算タイル
 * と同じ規約)。警告を出したくないジャンルは、予算を未設定のままにすればよい。
 */
function toneFor(genreId: string, budgetYen: number | null, spentYen: number) {
  return budgetTone({
    categoryId: genreId,
    budgetYen,
    carryOverYen: 0,
    spentYen,
    remainingYen: budgetYen === null ? null : budgetYen - spentYen,
    usageRatio: budgetYen !== null && budgetYen > 0 ? spentYen / budgetYen : null,
    transactionCount: 0,
  });
}

/** 集計済みの LedgerSummary から内訳を作る。金額の大きい順。 */
export function breakdownFromSummary(
  genres: readonly { id: string; name: string; budget_yen: number | null }[],
  summary: LedgerSummary,
): GenreBreakdownRow[] {
  const breakdown: GenreBreakdownRow[] = [];
  for (const g of genres) {
    const spentYen = summary.byGenre.get(g.id) ?? 0;
    if (spentYen <= 0) continue;
    breakdown.push({
      genreId: g.id,
      genreName: g.name,
      spentYen,
      budgetYen: g.budget_yen,
      tone: toneFor(g.id, g.budget_yen, spentYen),
    });
  }
  if (summary.uncategorizedYen > 0) {
    breakdown.push({
      genreId: null,
      genreName: UNCATEGORIZED_LABEL,
      spentYen: summary.uncategorizedYen,
      budgetYen: null,
      tone: 'normal',
    });
  }
  return breakdown.sort((a, b) => b.spentYen - a.spentYen);
}

/**
 * monthKey('YYYY-MM')の内訳。金額の大きい順。予算は月次の値(genres.budget_yen)を
 * どの月にも同じように当てる。支出の無いジャンルは出さず、未分類の支出があれば
 * 「未分類」を1行足す。予定(today より未来)は含めない。
 */
export function buildGenreBreakdown(
  genres: readonly { id: string; name: string; budget_yen: number | null }[],
  entries: readonly LedgerEntry[],
  monthKey: string,
  today: DateOnly,
): GenreBreakdownRow[] {
  return breakdownFromSummary(genres, summarizeLedger(entries, monthRange(monthKey), today));
}

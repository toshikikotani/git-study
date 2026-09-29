'use server';

/**
 * 家計簿(/spending)の Server Action。「AI家計診断」(本人発案、ADR-030)の
 * 唯一の入り口——本人がボタンを押した時だけ AI を呼ぶ(diagnosis-ai.ts 参照)。
 */

import { revalidatePath } from 'next/cache';

import { ClaudeSpendingDiagnosisAnalyzer } from '@/features/diagnosis/diagnosis-ai';
import {
  DiagnosisStoreError,
  listUndiagnosedTransactions,
  saveDiagnoses,
} from '@/features/diagnosis/store';
import { listExpenseSubtypesForTransactionIds } from '@/features/receipts/expense-subtype-store';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import type { GenreBreakdownRow } from '@/features/spending/ledger-types';
import { loadCalendarMonth } from '@/features/spending/store';
import { apiKeyMissingMessage } from '@/lib/anthropic';
import { addMonths, nthDayOfMonth, parseDateOnlyOr, todayJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { readAnthropicApiKey } from '@/lib/env';
import { toDrilldownTransactions } from './drilldown';
import type { DrilldownTransaction } from './category-breakdown-chart';

export type DiagnoseSpendingActionResult = {
  diagnosedCount: number;
  warnings: string[];
  error: string | null;
};

export async function diagnoseSpendingAction(): Promise<DiagnoseSpendingActionResult> {
  const apiKey = readAnthropicApiKey();
  if (apiKey === null) {
    return {
      diagnosedCount: 0,
      warnings: [],
      error: apiKeyMissingMessage('AI による診断'),
    };
  }

  let targets;
  try {
    targets = await listUndiagnosedTransactions();
  } catch (error) {
    return {
      diagnosedCount: 0,
      warnings: [],
      error: error instanceof DiagnosisStoreError ? error.message : '明細を取得できませんでした。',
    };
  }
  if (targets.length === 0) {
    return { diagnosedCount: 0, warnings: [], error: null };
  }

  const outcome = await new ClaudeSpendingDiagnosisAnalyzer(apiKey).diagnose(targets);
  if (outcome.results.length === 0) {
    return { diagnosedCount: 0, warnings: outcome.warnings, error: null };
  }

  try {
    await saveDiagnoses(
      outcome.results.map((r) => ({
        transactionId: r.id,
        verdict: r.verdict,
        reasoning: r.reasoning,
      })),
    );
  } catch (error) {
    return {
      diagnosedCount: 0,
      warnings: outcome.warnings,
      error:
        error instanceof DiagnosisStoreError ? error.message : '診断結果を保存できませんでした。',
    };
  }

  revalidatePath('/spending');
  return { diagnosedCount: outcome.results.length, warnings: outcome.warnings, error: null };
}

/** カレンダーが移動できる範囲(今日から前後何か月まで)。 */
const CALENDAR_MONTHS_BACK = 120;
const CALENDAR_MONTHS_FORWARD = 24;

export type CalendarMonthResult =
  | {
      error: null;
      transactions: DrilldownTransaction[];
      genreBreakdown: GenreBreakdownRow[];
    }
  | { error: string };

/**
 * カレンダーで過去・未来の月へ移ったときに、その月の明細とジャンル別の内訳を返す。
 * 月は 'YYYY-MM-DD' の任意の日を受け、その月の1日に直す(形式不正は今月)。
 */
export async function loadCalendarMonthAction(month: string): Promise<CalendarMonthResult> {
  try {
    const today = todayJst();
    const monthStart = nthDayOfMonth(parseDateOnlyOr(month, today), 1);
    const earliest = addMonths(nthDayOfMonth(today, 1), -CALENDAR_MONTHS_BACK);
    const latest = addMonths(nthDayOfMonth(today, 1), CALENDAR_MONTHS_FORWARD);
    if (monthStart < earliest || monthStart > latest) {
      return { error: 'この月のカレンダーは表示できません' };
    }

    const { transactions, genreBreakdown } = await loadCalendarMonth(monthStart);
    const ids = transactions.map((t) => t.id);
    const [items, subtypes] = await Promise.all([
      listReceiptItemsForTransactionIds(ids),
      listExpenseSubtypesForTransactionIds(ids),
    ]);
    return {
      error: null,
      transactions: toDrilldownTransactions(transactions, items, subtypes),
      genreBreakdown,
    };
  } catch (error) {
    return {
      error: error instanceof AppError ? error.message : 'この月の明細を読み込めませんでした。',
    };
  }
}

/**
 * 支出の「浪費 か 必要経費 か」診断の集計(本人発案:「投資家目線で今のが
 * 浪費か必要経費なのか判断する機構とそれを分析結果を蓄積表示改善する機能」)。
 *
 * category_kind(浪費/生活費/聖域...)はカテゴリ単位の静的な分類で、同じ
 * カテゴリでも1件ごとの事情までは表さない(例:「外食」でも仕事の会食と
 * 気晴らしの外食では意味が違う)。ここでの判断は明細1件ごとにAIが下す
 * 動的な評定(features/diagnosis/diagnosis-ai.ts、ADR-030)で、判断の中身
 * (プロンプト設計)はAI呼び出し側の責務。ここでは判断結果を集計する
 * 純粋関数だけを持つ(domain/spending.ts と同じ「集計はここ、判断はそこ」
 * の分業)。
 */

import { isCountable, type BudgetTransaction } from './budget';
import type { DateOnly } from '@/lib/date';

export type SpendingVerdict = 'waste' | 'necessary';

export type DiagnosedTransaction = BudgetTransaction & {
  occurredOn: DateOnly;
  verdict: SpendingVerdict;
};

export type DiagnosisSummary = {
  /** 浪費と診断された支出の合計(正の数)。 */
  wasteYen: number;
  /** 必要経費と診断された支出の合計(正の数)。 */
  necessaryYen: number;
  /** 診断済み支出のうち浪費の割合(0〜1)。診断が1件も無ければ null。 */
  wasteRatio: number | null;
};

/**
 * 診断済みの支出をまとめる。収入・振替・対象外(domain/budget.ts の
 * isCountable() と同じ定義)は含めない——診断はそもそも「支出」を
 * 対象にした判断であり、収入・振替に浪費/必要経費のラベルは意味を持たない。
 */
export function summarizeDiagnoses(
  transactions: readonly DiagnosedTransaction[],
): DiagnosisSummary {
  let wasteYen = 0;
  let necessaryYen = 0;

  for (const tx of transactions) {
    if (!isCountable(tx) || tx.amountYen >= 0) continue;
    if (tx.verdict === 'waste') {
      wasteYen -= tx.amountYen;
    } else {
      necessaryYen -= tx.amountYen;
    }
  }

  const totalYen = wasteYen + necessaryYen;
  return {
    wasteYen,
    necessaryYen,
    wasteRatio: totalYen > 0 ? wasteYen / totalYen : null,
  };
}

export type MonthlyDiagnosisSummary = {
  monthKey: string;
  wasteYen: number;
  necessaryYen: number;
};

/**
 * 月ごとの浪費/必要経費を集計する(本人発案:「蓄積して改善」の推移表示)。
 * domain/spending.ts の summarizeMonthlyIncomeExpense() と同じ都度集計の
 * 考え方だが、対象月・対象明細の0円埋めはしない——診断していない月・明細は
 * 「浪費0円」ではなく「まだ判断が無い」であり、両者を区別できないと
 * 推移グラフが誤解を招く(呼び出し側が「診断件数が無い月」を別に扱う)。
 */
export function summarizeDiagnosesByMonth(
  transactions: readonly DiagnosedTransaction[],
  monthKeys: readonly string[],
): MonthlyDiagnosisSummary[] {
  const byMonth = new Map<string, { wasteYen: number; necessaryYen: number }>();

  for (const tx of transactions) {
    if (!isCountable(tx) || tx.amountYen >= 0) continue;
    const monthKey = tx.occurredOn.slice(0, 7);
    const current = byMonth.get(monthKey) ?? { wasteYen: 0, necessaryYen: 0 };
    if (tx.verdict === 'waste') {
      current.wasteYen -= tx.amountYen;
    } else {
      current.necessaryYen -= tx.amountYen;
    }
    byMonth.set(monthKey, current);
  }

  return monthKeys.map((monthKey) => ({
    monthKey,
    wasteYen: byMonth.get(monthKey)?.wasteYen ?? 0,
    necessaryYen: byMonth.get(monthKey)?.necessaryYen ?? 0,
  }));
}

/** その月の浪費割合(0〜1)。診断済みの支出が無ければ null(0%と誤読させない)。 */
export function wasteRatioOf(entry: MonthlyDiagnosisSummary): number | null {
  const totalYen = entry.wasteYen + entry.necessaryYen;
  return totalYen > 0 ? entry.wasteYen / totalYen : null;
}

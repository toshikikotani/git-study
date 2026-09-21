/**
 * AI月次レポート(ai_monthly_reports)のデータアクセス(本人発案「AI関連
 * もっと増やしたい」、ADR-031)。
 *
 * `ai_monthly_reports` は本番 Supabase へのマイグレーション適用手段がこの
 * セッションに無く(T-25/T-26/B-7/B-10/B-12/B-13 と同じ制約)未適用のため、
 * 読み取りはテーブル未作成のエラー(PGRST205)を「レポートはまだ無い」として
 * 握り潰す(goals・transaction_diagnoses と同じ考え方。適用後は自動的に
 * 効き始める)。一方 saveMonthlyReport() は本人の明示的な操作(「レポートを
 * 作る」ボタン)の結果なので握り潰さず、分かりやすいメッセージにしてそのまま
 * エラーとして返す。
 *
 * 入力データ(loadMonthlyReportInput)は既存の store 層(spending・diagnosis・
 * home)をそのまま呼び出して組み立てるだけで、新しい集計クエリは増やさない。
 */

import type { PostgrestError } from '@supabase/supabase-js';

import { wasteRatioOf } from '@/domain/diagnosis';
import type { SpendingPersonaType } from '@/domain/persona';
import { loadSpendingDiagnosisView } from '@/features/diagnosis/store';
import { loadHomeSummary } from '@/features/home/summary';
import { loadMonthlyLedger } from '@/features/spending/store';
import { monthStartJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import { MAX_ITEMS_PER_LIST, type MonthlyReportInput } from './monthly-report-ai';

export class AiReportStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiReportStoreError';
  }
}

function isMissingTableError(error: Pick<PostgrestError, 'code'>): boolean {
  return error.code === 'PGRST205';
}

/**
 * 今月分のレポート入力データを組み立てる。既存の store 層(家計簿・診断・
 * ホーム)をそのまま呼び出すだけで、新規クエリは増やさない。
 */
export async function loadMonthlyReportInput(now: Date = new Date()): Promise<MonthlyReportInput> {
  const [ledger, diagnosis, home] = await Promise.all([
    loadMonthlyLedger(now),
    loadSpendingDiagnosisView(now),
    loadHomeSummary(now),
  ]);

  return {
    monthKey: monthStartJst(0, now).slice(0, 7),
    totalSpentYen: ledger.totalSpentYen,
    totalIncomeYen: ledger.totalIncomeYen,
    wasteYen: diagnosis.currentMonth.summary.wasteYen,
    necessaryYen: diagnosis.currentMonth.summary.necessaryYen,
    wasteRatio: diagnosis.currentMonth.summary.wasteRatio,
    undiagnosedCount: diagnosis.currentMonth.undiagnosedCount,
    categoryBreakdown: ledger.categoryBreakdown
      .filter((c) => c.spentYen > 0)
      .slice(0, MAX_ITEMS_PER_LIST)
      .map((c) => ({ name: c.categoryName, spentYen: c.spentYen, budgetYen: c.budgetYen })),
    topWasteItems: diagnosis.currentMonth.wasteItems.slice(0, MAX_ITEMS_PER_LIST).map((item) => ({
      label: item.label,
      amountYen: item.amountYen,
      reasoning: item.reasoning,
    })),
    topNecessaryItems: diagnosis.currentMonth.necessaryItems
      .slice(0, MAX_ITEMS_PER_LIST)
      .map((item) => ({
        label: item.label,
        amountYen: item.amountYen,
        reasoning: item.reasoning,
      })),
    wasteRatioTrend: diagnosis.trend.rows.map((row) => ({
      monthKey: row.monthKey,
      wasteRatio: wasteRatioOf(row),
    })),
    payoff: {
      remainingYen: home.payoff.remainingYen,
      progressRatio: home.payoff.progressRatio,
      reducedThisMonthYen: home.payoff.reducedThisMonthYen,
      daysRemaining: home.payoff.daysRemaining,
    },
  };
}

export type SaveMonthlyReportInput = {
  personaType: SpendingPersonaType;
  personaReasoning: string;
  insights: readonly string[];
  advice: readonly string[];
};

/** 月次レポートを保存する。1ヶ月1行(再生成は upsert で上書き)。 */
export async function saveMonthlyReport(
  monthKey: string,
  result: SaveMonthlyReportInput,
): Promise<void> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new AiReportStoreError('ログイン状態を確認できませんでした');
  }

  const { error } = await supabase.from('ai_monthly_reports').upsert(
    {
      user_id: auth.user.id,
      month: `${monthKey}-01`,
      persona_type: result.personaType,
      persona_reasoning: result.personaReasoning,
      insights: [...result.insights],
      advice: [...result.advice],
    },
    { onConflict: 'user_id,month' },
  );
  if (error) {
    if (isMissingTableError(error)) {
      throw new AiReportStoreError('レポート機能はまだ利用できません');
    }
    throw new AiReportStoreError(`レポートを保存できませんでした: ${error.message}`);
  }
}

export type MonthlyAiReport = {
  personaType: SpendingPersonaType;
  personaReasoning: string;
  insights: readonly string[];
  advice: readonly string[];
  createdAt: string;
};

/** 指定月のレポートを読む。無ければ null(テーブル未作成もこの扱いに含む)。 */
export async function loadMonthlyReport(monthKey: string): Promise<MonthlyAiReport | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_monthly_reports')
    .select('persona_type, persona_reasoning, insights, advice, created_at')
    .eq('month', `${monthKey}-01`)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new AiReportStoreError(`レポートを取得できませんでした: ${error.message}`);
  }
  if (!data) return null;

  return {
    personaType: data.persona_type,
    personaReasoning: data.persona_reasoning,
    insights: data.insights,
    advice: data.advice,
    createdAt: data.created_at,
  };
}

export type MonthlyAiReportView = {
  input: MonthlyReportInput;
  report: MonthlyAiReport | null;
};

/** /reports/ai の画面向けビュー。数値データ(常に取得可能)とレポート(無ければ null)をまとめて返す。 */
export async function loadMonthlyAiReportView(
  now: Date = new Date(),
): Promise<MonthlyAiReportView> {
  const input = await loadMonthlyReportInput(now);
  const report = await loadMonthlyReport(input.monthKey);
  return { input, report };
}

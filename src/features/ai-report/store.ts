/**
 * AI月次・日次レポートのデータアクセス(ADR-031/ADR-032)。
 *
 * 入力は既存の store 層(spending・diagnosis・home)を呼ぶだけで、集計クエリを
 * 増やさない。両テーブルは本番未適用(B-14/B-15)。未適用時の扱いは
 * lib/supabase/errors.ts。
 */

import { wasteRatioOf } from '@/domain/diagnosis';
import type { SpendingPersonaType } from '@/domain/persona';
import { loadSpendingDiagnosisView } from '@/features/diagnosis/store';
import { loadHomeSummary } from '@/features/home/summary';
import { averageDailySpendYen } from '@/domain/spending';
import { loadMonthlyLedger } from '@/features/spending/store';
import { monthStartJst, todayJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import { aiTrust } from '@/domain/ai-forecast-read';
import { calendarContext } from '@/domain/forecast/calendar';
import { loadForecast } from '@/features/forecast/load';
import { getAppSettings } from '@/features/settings/store';
import { addDays, addMonths } from '@/lib/date';
import type { DailyReportInput } from './daily-report-ai';
import {
  loadLatestRead,
  loadReadEvidence,
  loadScoredReads,
  type ForecastReadView,
} from './forecast-read';
import {
  MAX_ITEMS_PER_LIST,
  type MonthlyReportForecast,
  type MonthlyReportInput,
} from './monthly-report-ai';

export class AiReportStoreError extends AppError {}

/**
 * 今月分のレポート入力データを組み立てる。既存の store 層(家計簿・診断・
 * ホーム)をそのまま呼び出すだけで、新規クエリは増やさない。
 */
export async function loadMonthlyReportInput(now: Date = new Date()): Promise<MonthlyReportInput> {
  const today = todayJst(now);
  const monthStart = monthStartJst(0, now);
  const monthRange = { from: monthStart, to: addDays(addMonths(monthStart, 1), -1) };
  const [ledger, diagnosis, home, forecast, settings, past] = await Promise.all([
    loadMonthlyLedger(now),
    loadSpendingDiagnosisView(now),
    loadHomeSummary(now),
    // 着地の見込み(確率予測 v2)。作れなくてもレポートは作る(AIの読みだけ出さない)。
    loadForecast({ period: monthRange, now }).catch(() => null),
    getAppSettings().catch(() => null),
    // 過去の読み・品目が読めなくても、レポートは作る(読みは「当たり具合まだ無し」で出す)。
    loadScoredReads(monthStart, today).catch(() => ({ reads: [], trust: aiTrust([]) })),
  ]);
  const evidence = await loadReadEvidence(ledger.transactions, monthRange, today).catch(() => ({
    notable: [],
    scheduled: [],
  }));

  return {
    monthKey: monthStartJst(0, now).slice(0, 7),
    totalSpentYen: ledger.totalSpentYen,
    totalIncomeYen: ledger.totalIncomeYen,
    wasteYen: diagnosis.currentMonth.summary.wasteYen,
    necessaryYen: diagnosis.currentMonth.summary.necessaryYen,
    wasteRatio: diagnosis.currentMonth.summary.wasteRatio,
    undiagnosedCount: diagnosis.currentMonth.undiagnosedCount,
    categoryBreakdown: ledger.genreBreakdown
      .filter((g) => g.spentYen > 0)
      .slice(0, MAX_ITEMS_PER_LIST)
      .map((g) => ({ name: g.genreName, spentYen: g.spentYen, budgetYen: g.budgetYen })),
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
    forecast: forecast === null ? null : forecastSummary(forecast.forecast),
    evidence: {
      ...evidence,
      calendar: calendarContext(today, monthRange.to, settings?.payday ?? null),
      pastReads: past.reads,
      trust: past.trust,
    },
  };
}

function forecastSummary(
  f: Awaited<ReturnType<typeof loadForecast>>['forecast'],
): MonthlyReportForecast {
  return {
    asOf: f.asOf,
    remainingDays: f.remainingDays,
    knownYen: f.actualYen + f.committed.scheduledYen + f.committed.fixedYen,
    p10: f.total.p10,
    p50: f.total.p50,
    p90: f.total.p90,
    unrecordedYen: f.unrecordedYen,
    billsYen: f.bills.expectedYen,
    visitsYen: f.visits.expectedYen,
    specialYen: f.special.expected,
    remainingPerDayYen: f.pace.perDayYen,
    recentPerDayYen: f.pace.recentPerDayYen,
    provisional: f.provisional,
    categories: [...f.byCategory]
      .sort((a, b) => b.landing.p50 - a.landing.p50)
      .slice(0, MAX_ITEMS_PER_LIST)
      .map((c) => ({ name: c.categoryName, actualYen: c.actualYen, p50: c.landing.p50 })),
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
  /** 今月の最新のAIの読み(着地の見込みへの補正)。無ければ null。 */
  forecastRead: ForecastReadView | null;
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
    forecastRead: await loadLatestRead(`${monthKey}-01`).catch(() => null),
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

/**
 * 今日分のレポート入力データを組み立てる。今月の家計簿・診断ビューを
 * そのまま呼び出し、今日の日付でフィルタするだけ(新規クエリは増やさない)。
 */
export async function loadDailyReportInput(now: Date = new Date()): Promise<DailyReportInput> {
  const monthStart = monthStartJst(0, now);
  const [ledger, diagnosis, forecast] = await Promise.all([
    loadMonthlyLedger(now),
    loadSpendingDiagnosisView(now),
    loadForecast({
      period: { from: monthStart, to: addDays(addMonths(monthStart, 1), -1) },
      now,
    }).catch(() => null),
  ]);

  const today = todayJst(now);
  const todaysSpending = ledger.transactions.filter(
    (tx) => tx.occurredOn === today && tx.amountYen < 0,
  );
  const totalSpentYen = todaysSpending.reduce((acc, tx) => acc - tx.amountYen, 0);

  const categoryTotals = new Map<string, number>();
  for (const tx of todaysSpending) {
    const name = tx.genreName ?? '未分類';
    categoryTotals.set(name, (categoryTotals.get(name) ?? 0) - tx.amountYen);
  }
  const categoryBreakdown = [...categoryTotals.entries()]
    .map(([name, amountYen]) => ({ name, amountYen }))
    .sort((a, b) => b.amountYen - a.amountYen);

  const toItem = (item: { label: string; amountYen: number; reasoning: string }) => ({
    label: item.label,
    amountYen: item.amountYen,
    reasoning: item.reasoning,
  });

  return {
    dateKey: today,
    totalSpentYen,
    transactionCount: todaysSpending.length,
    categoryBreakdown,
    averageDailySpendYen: averageDailySpendYen(
      ledger.pace.thisMonthToDateYen,
      ledger.pace.dayOfMonth,
    ),
    wasteItems: diagnosis.currentMonth.wasteItems
      .filter((item) => item.occurredOn === today)
      .map(toItem),
    necessaryItems: diagnosis.currentMonth.necessaryItems
      .filter((item) => item.occurredOn === today)
      .map(toItem),
    monthLanding:
      forecast === null
        ? null
        : {
            p10: forecast.forecast.total.p10,
            p50: forecast.forecast.total.p50,
            p90: forecast.forecast.total.p90,
            remainingPerDayYen: forecast.forecast.pace.perDayYen,
          },
  };
}

export type SaveDailyReportInput = {
  insights: readonly string[];
  advice: readonly string[];
};

/** 日次レポートを保存する。1日1行(再生成は upsert で上書き)。 */
export async function saveDailyReport(
  dateKey: string,
  result: SaveDailyReportInput,
): Promise<void> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new AiReportStoreError('ログイン状態を確認できませんでした');
  }

  const { error } = await supabase.from('ai_daily_reports').upsert(
    {
      user_id: auth.user.id,
      report_date: dateKey,
      insights: [...result.insights],
      advice: [...result.advice],
    },
    { onConflict: 'user_id,report_date' },
  );
  if (error) {
    if (isMissingTableError(error)) {
      throw new AiReportStoreError('レポート機能はまだ利用できません');
    }
    throw new AiReportStoreError(`レポートを保存できませんでした: ${error.message}`);
  }
}

export type DailyAiReport = {
  insights: readonly string[];
  advice: readonly string[];
  createdAt: string;
};

/** 指定日のレポートを読む。無ければ null(テーブル未作成もこの扱いに含む)。 */
export async function loadDailyReport(dateKey: string): Promise<DailyAiReport | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_daily_reports')
    .select('insights, advice, created_at')
    .eq('report_date', dateKey)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new AiReportStoreError(`レポートを取得できませんでした: ${error.message}`);
  }
  if (!data) return null;

  return {
    insights: data.insights,
    advice: data.advice,
    createdAt: data.created_at,
  };
}

export type DailyAiReportView = {
  input: DailyReportInput;
  report: DailyAiReport | null;
};

/** /reports/ai の画面向けビュー(日次分)。数値データとレポート(無ければ null)をまとめて返す。 */
export async function loadDailyAiReportView(now: Date = new Date()): Promise<DailyAiReportView> {
  const input = await loadDailyReportInput(now);
  const report = await loadDailyReport(input.dateKey);
  return { input, report };
}

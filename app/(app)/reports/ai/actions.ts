'use server';

/**
 * AI月次・日次レポート(/reports/ai)の Server Action(本人発案、
 * ADR-031/ADR-032)。本人がボタンを押した時だけ AI を呼ぶ唯一の入り口
 * (monthly-report-ai.ts・daily-report-ai.ts 参照)。
 */

import { revalidatePath } from 'next/cache';

import { ClaudeDailyReportAnalyzer } from '@/features/ai-report/daily-report-ai';
import { ClaudeMonthlyReportAnalyzer } from '@/features/ai-report/monthly-report-ai';
import {
  AiReportStoreError,
  loadDailyReportInput,
  loadMonthlyReportInput,
  saveDailyReport,
  saveMonthlyReport,
  type DailyAiReport,
  type MonthlyAiReport,
} from '@/features/ai-report/store';

export type GenerateMonthlyReportActionResult = {
  /**
   * 生成直後にこの画面上で即座に見せるための本体(Server Action の戻り値に
   * 含める。revalidatePath だけに頼ると、この呼び出し元コンポーネントの
   * useState はプロップの更新では自動的に同期されないため)。
   */
  report: MonthlyAiReport | null;
  error: string | null;
  warnings: string[];
};

export async function generateMonthlyAiReportAction(): Promise<GenerateMonthlyReportActionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    return {
      report: null,
      error: 'AI によるレポート生成は設定されていません(ANTHROPIC_API_KEY が未設定)。',
      warnings: [],
    };
  }

  let input;
  try {
    input = await loadMonthlyReportInput();
  } catch (error) {
    return {
      report: null,
      error: error instanceof Error ? error.message : '今月のデータを取得できませんでした。',
      warnings: [],
    };
  }

  const outcome = await new ClaudeMonthlyReportAnalyzer(apiKey).generate(input);
  if (outcome.report === null) {
    return { report: null, error: null, warnings: outcome.warnings };
  }

  try {
    await saveMonthlyReport(input.monthKey, outcome.report);
  } catch (error) {
    return {
      report: null,
      error:
        error instanceof AiReportStoreError ? error.message : 'レポートを保存できませんでした。',
      warnings: outcome.warnings,
    };
  }

  revalidatePath('/reports/ai');
  return {
    report: { ...outcome.report, createdAt: new Date().toISOString() },
    error: null,
    warnings: outcome.warnings,
  };
}

export type GenerateDailyReportActionResult = {
  report: DailyAiReport | null;
  error: string | null;
  warnings: string[];
};

export async function generateDailyAiReportAction(): Promise<GenerateDailyReportActionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    return {
      report: null,
      error: 'AI によるレポート生成は設定されていません(ANTHROPIC_API_KEY が未設定)。',
      warnings: [],
    };
  }

  let input;
  try {
    input = await loadDailyReportInput();
  } catch (error) {
    return {
      report: null,
      error: error instanceof Error ? error.message : '今日のデータを取得できませんでした。',
      warnings: [],
    };
  }

  const outcome = await new ClaudeDailyReportAnalyzer(apiKey).generate(input);
  if (outcome.report === null) {
    return { report: null, error: null, warnings: outcome.warnings };
  }

  try {
    await saveDailyReport(input.dateKey, outcome.report);
  } catch (error) {
    return {
      report: null,
      error:
        error instanceof AiReportStoreError ? error.message : 'レポートを保存できませんでした。',
      warnings: outcome.warnings,
    };
  }

  revalidatePath('/reports/ai');
  return {
    report: { ...outcome.report, createdAt: new Date().toISOString() },
    error: null,
    warnings: outcome.warnings,
  };
}

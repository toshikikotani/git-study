'use server';

/**
 * AI月次・日次レポート(/reports/ai)の Server Action(ADR-031/ADR-032)。
 * 本人がボタンを押した時だけ AI を呼ぶ唯一の入り口。
 */

import { revalidatePath } from 'next/cache';

import { ClaudeDailyReportAnalyzer } from '@/features/ai-report/daily-report-ai';
import { ClaudeMonthlyReportAnalyzer } from '@/features/ai-report/monthly-report-ai';
import {
  loadDailyReportInput,
  loadMonthlyReportInput,
  saveDailyReport,
  saveMonthlyReport,
  type DailyAiReport,
  type MonthlyAiReport,
} from '@/features/ai-report/store';
import { apiKeyMissingMessage } from '@/lib/anthropic';
import { readAnthropicApiKey } from '@/lib/env';
import { describeUserError } from '@/lib/errors';

export type GenerateReportActionResult<T> = {
  /**
   * 生成直後に画面へ即座に出すための本体。revalidatePath だけに頼ると、
   * 呼び出し元の useState はプロップ更新では同期されないため戻り値でも返す。
   */
  report: T | null;
  error: string | null;
  warnings: string[];
};

export type GenerateMonthlyReportActionResult = GenerateReportActionResult<MonthlyAiReport>;
export type GenerateDailyReportActionResult = GenerateReportActionResult<DailyAiReport>;

export async function generateMonthlyAiReportAction(): Promise<GenerateMonthlyReportActionResult> {
  return runReportAction({
    load: loadMonthlyReportInput,
    loadFailed: '今月のデータを取得できませんでした。',
    generate: (apiKey, input) => new ClaudeMonthlyReportAnalyzer(apiKey).generate(input),
    save: (input, report) => saveMonthlyReport(input.monthKey, report),
  });
}

export async function generateDailyAiReportAction(): Promise<GenerateDailyReportActionResult> {
  return runReportAction({
    load: loadDailyReportInput,
    loadFailed: '今日のデータを取得できませんでした。',
    generate: (apiKey, input) => new ClaudeDailyReportAnalyzer(apiKey).generate(input),
    save: (input, report) => saveDailyReport(input.dateKey, report),
  });
}

/** 月次も日次も手順は同じ:キー確認 → 入力取得 → AI → 保存 → 再取得。 */
async function runReportAction<Input, Body>(step: {
  load: () => Promise<Input>;
  loadFailed: string;
  generate: (apiKey: string, input: Input) => Promise<{ report: Body | null; warnings: string[] }>;
  save: (input: Input, report: Body) => Promise<void>;
}): Promise<GenerateReportActionResult<Body & { createdAt: string }>> {
  const apiKey = readAnthropicApiKey();
  if (apiKey === null) {
    return {
      report: null,
      error: apiKeyMissingMessage('AI によるレポート生成'),
      warnings: [],
    };
  }

  let input: Input;
  try {
    input = await step.load();
  } catch (error) {
    return { report: null, error: describeUserError(error, step.loadFailed), warnings: [] };
  }

  const outcome = await step.generate(apiKey, input);
  if (outcome.report === null) {
    return { report: null, error: null, warnings: outcome.warnings };
  }

  try {
    await step.save(input, outcome.report);
  } catch (error) {
    return {
      report: null,
      error: describeUserError(error, 'レポートを保存できませんでした。'),
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

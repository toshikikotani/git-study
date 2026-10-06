'use server';

/**
 * AI月次・日次レポート(/reports/ai)の Server Action(ADR-031/ADR-032)。
 * 本人がボタンを押した時だけ AI を呼ぶ唯一の入り口。
 */

import { revalidatePath } from 'next/cache';

import { ClaudeDailyReportAnalyzer } from '@/features/ai-report/daily-report-ai';
import { ClaudeMonthlyReportAnalyzer } from '@/features/ai-report/monthly-report-ai';
import { saveForecastRead } from '@/features/ai-report/forecast-read';
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
    save: async (input, report) => {
      await saveMonthlyReport(input.monthKey, report);
      // AIの読みは、統計の見込みと当たり具合から金額をここで計算して、1行足す(ADR-072)。
      const read =
        report.forecastRead !== null && input.forecast !== null
          ? await saveForecastRead({
              monthStart: `${input.monthKey}-01`,
              asOf: input.forecast.asOf,
              knownYen: input.forecast.knownYen,
              stat: { p10: input.forecast.p10, p50: input.forecast.p50, p90: input.forecast.p90 },
              percent: report.forecastRead.percent,
              trust: input.evidence.trust.weight,
              reason: report.forecastRead.reason,
              evidence: report.forecastRead.evidence,
            })
          : null;
      return { ...report, forecastRead: read };
    },
  });
}

export async function generateDailyAiReportAction(): Promise<GenerateDailyReportActionResult> {
  return runReportAction({
    load: loadDailyReportInput,
    loadFailed: '今日のデータを取得できませんでした。',
    generate: (apiKey, input) => new ClaudeDailyReportAnalyzer(apiKey).generate(input),
    save: async (input, report) => {
      await saveDailyReport(input.dateKey, report);
      return report;
    },
  });
}

/** 月次も日次も手順は同じ:キー確認 → 入力取得 → AI → 保存 → 再取得。 */
async function runReportAction<Input, Body, Saved>(step: {
  load: () => Promise<Input>;
  loadFailed: string;
  generate: (apiKey: string, input: Input) => Promise<{ report: Body | null; warnings: string[] }>;
  /** 保存して、画面に返す本体を作る。 */
  save: (input: Input, report: Body) => Promise<Saved>;
}): Promise<GenerateReportActionResult<Saved & { createdAt: string }>> {
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

  let saved: Saved;
  try {
    saved = await step.save(input, outcome.report);
  } catch (error) {
    return {
      report: null,
      error: describeUserError(error, 'レポートを保存できませんでした。'),
      warnings: outcome.warnings,
    };
  }

  revalidatePath('/reports/ai');
  return {
    report: { ...saved, createdAt: new Date().toISOString() },
    error: null,
    warnings: outcome.warnings,
  };
}

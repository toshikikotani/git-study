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
import { apiKeyMissingMessage } from '@/lib/anthropic';
import { readAnthropicApiKey } from '@/lib/env';

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

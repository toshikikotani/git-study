'use server';

/**
 * カテゴリ分析(/reports/genres)の Server Action(本人発案、ADR-056)。
 *
 * 「カテゴリ分類する」は AI家計診断(ADR-030)の diagnoseSpendingAction() と
 * 同じ、本人がボタンを押した時だけ AI を呼ぶ唯一の入り口。カテゴリの追加・削除などの
 * 管理は「設定 > カテゴリ」(/settings/categories)に一本化した。
 */

import { revalidatePath } from 'next/cache';

import { ClaudeGenreClassifier } from '@/features/genre/genre-ai';
import {
  GenreStoreError,
  listGenres,
  listUngenredSpendTargets,
  listUngenredSpendTargetsAllPeriods,
  MAX_BATCH_SIZE,
  saveGenres,
} from '@/features/genre/store';
import { apiKeyMissingMessage } from '@/lib/anthropic';
import { readAnthropicApiKey } from '@/lib/env';

export type ClassifyGenresActionResult = {
  classifiedCount: number;
  /** 1回の処理上限に達した。まだ未分類が残っている可能性が高い。 */
  hasMore: boolean;
  warnings: string[];
  error: string | null;
};

/** scope='month' は今月分、'all' は過去分も含めた全期間。1回の上限(120件)ずつ処理するため、
 * 呼び出し側が hasMore の間くり返し呼ぶ。 */
export async function classifyGenresAction(
  scope: 'month' | 'all' = 'month',
): Promise<ClassifyGenresActionResult> {
  const apiKey = readAnthropicApiKey();
  if (apiKey === null) {
    return {
      classifiedCount: 0,
      hasMore: false,
      warnings: [],
      error: apiKeyMissingMessage('AIによるカテゴリ分類'),
    };
  }

  let targets;
  let genreOptions;
  try {
    [targets, genreOptions] = await Promise.all([
      scope === 'all' ? listUngenredSpendTargetsAllPeriods() : listUngenredSpendTargets(),
      listGenres(),
    ]);
  } catch (error) {
    return {
      classifiedCount: 0,
      hasMore: false,
      warnings: [],
      error: error instanceof GenreStoreError ? error.message : '明細を取得できませんでした。',
    };
  }
  if (targets.length === 0) {
    return { classifiedCount: 0, hasMore: false, warnings: [], error: null };
  }

  const outcome = await new ClaudeGenreClassifier(apiKey).classifyMany(
    targets.map((t) => ({ id: t.id, label: t.label, amountYen: t.amountYen })),
    genreOptions,
  );
  if (outcome.classifications.length === 0) {
    return { classifiedCount: 0, hasMore: false, warnings: outcome.warnings, error: null };
  }

  const targetById = new Map(targets.map((t) => [t.id, t]));
  try {
    await saveGenres(
      outcome.classifications.map((c) => ({
        kind: targetById.get(c.id)!.kind,
        id: c.id,
        genreId: c.genreId,
        confidence: c.confidence,
      })),
    );
  } catch (error) {
    return {
      classifiedCount: 0,
      hasMore: false,
      warnings: outcome.warnings,
      error: error instanceof GenreStoreError ? error.message : '分類結果を保存できませんでした。',
    };
  }

  revalidatePath('/reports/genres');
  revalidatePath('/spending');
  return {
    classifiedCount: outcome.classifications.length,
    hasMore: targets.length >= MAX_BATCH_SIZE,
    warnings: outcome.warnings,
    error: null,
  };
}

'use server';

/**
 * 支出ジャンル分析(/reports/genres)の Server Action(本人発案、ADR-056)。
 *
 * 「ジャンル分類する」は AI家計診断(ADR-030)の diagnoseSpendingAction() と
 * 同じ、本人がボタンを押した時だけ AI を呼ぶ唯一の入り口。ジャンルの追加・
 * 削除は /rules の createCategoryAction()/deleteCategoryAction() と同じ形。
 */

import { revalidatePath } from 'next/cache';

import { ClaudeGenreClassifier } from '@/features/genre/genre-ai';
import {
  createGenre,
  deleteGenre,
  GenreStoreError,
  listGenres,
  listUngenredSpendTargets,
  saveGenres,
} from '@/features/genre/store';
import { apiKeyMissingMessage } from '@/lib/anthropic';
import { describeUserError } from '@/lib/errors';
import { readAnthropicApiKey } from '@/lib/env';

export type ClassifyGenresActionResult = {
  classifiedCount: number;
  warnings: string[];
  error: string | null;
};

export async function classifyGenresAction(): Promise<ClassifyGenresActionResult> {
  const apiKey = readAnthropicApiKey();
  if (apiKey === null) {
    return {
      classifiedCount: 0,
      warnings: [],
      error: apiKeyMissingMessage('AIによるジャンル分類'),
    };
  }

  let targets;
  let genreOptions;
  try {
    [targets, genreOptions] = await Promise.all([listUngenredSpendTargets(), listGenres()]);
  } catch (error) {
    return {
      classifiedCount: 0,
      warnings: [],
      error: error instanceof GenreStoreError ? error.message : '明細を取得できませんでした。',
    };
  }
  if (targets.length === 0) {
    return { classifiedCount: 0, warnings: [], error: null };
  }

  const outcome = await new ClaudeGenreClassifier(apiKey).classifyMany(
    targets.map((t) => ({ id: t.id, label: t.label, amountYen: t.amountYen })),
    genreOptions,
  );
  if (outcome.classifications.length === 0) {
    return { classifiedCount: 0, warnings: outcome.warnings, error: null };
  }

  const targetById = new Map(targets.map((t) => [t.id, t]));
  try {
    await saveGenres(
      outcome.classifications.map((c) => ({
        kind: targetById.get(c.id)!.kind,
        id: c.id,
        genreId: c.genreId,
      })),
    );
  } catch (error) {
    return {
      classifiedCount: 0,
      warnings: outcome.warnings,
      error: error instanceof GenreStoreError ? error.message : '分類結果を保存できませんでした。',
    };
  }

  revalidatePath('/reports/genres');
  return {
    classifiedCount: outcome.classifications.length,
    warnings: outcome.warnings,
    error: null,
  };
}

export async function createGenreAction(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  try {
    await createGenre(String(formData.get('name') ?? ''));
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/reports/genres');
  return { error: null };
}

export async function deleteGenreAction(id: string): Promise<{ error: string | null }> {
  try {
    await deleteGenre(id);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/reports/genres');
  return { error: null };
}

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
  listUngenredSpendTargetsAllPeriods,
  MAX_BATCH_SIZE,
  saveGenres,
  setGenreShowOnHome,
  updateGenreBudget,
} from '@/features/genre/store';
import { apiKeyMissingMessage } from '@/lib/anthropic';
import { describeUserError } from '@/lib/errors';
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
      error: apiKeyMissingMessage('AIによるジャンル分類'),
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

/**
 * 月次予算(本人発案「カテゴリのそれぞれの値段設定」)を変更する。
 * 空文字は「無制限」(budget_yen = null)として扱う。
 */
export async function updateGenreBudgetAction(
  id: string,
  budgetYenInput: string,
): Promise<{ error: string | null }> {
  const trimmed = budgetYenInput.trim();
  const budgetYen = trimmed === '' ? null : Number(trimmed);
  if (budgetYen !== null && !Number.isInteger(budgetYen)) {
    return { error: '予算は整数円で入力してください' };
  }
  try {
    await updateGenreBudget(id, budgetYen);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/reports/genres');
  revalidatePath('/');
  revalidatePath('/spending');
  return { error: null };
}

/** ホーム画面に残額を出すジャンルか(FR-14, FR-61)。 */
export async function setGenreShowOnHomeAction(
  id: string,
  showOnHome: boolean,
): Promise<{ error: string | null }> {
  try {
    await setGenreShowOnHome(id, showOnHome);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/reports/genres');
  revalidatePath('/');
  return { error: null };
}

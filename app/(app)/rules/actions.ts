'use server';

/**
 * `/rules` の Server Action(M2-6)。
 *
 * カテゴリ側はフォーム経由(useActionState)、分類ルール側は1タップの操作
 * (優先度の入れ替え・有効無効・削除)なので、確認待ちキュー(M2-5)の
 * `createLearnedRuleAction` と同じく直接呼び出しにする。
 */

import { revalidatePath } from 'next/cache';

import { assertCategoryBudgetYen, assertCategoryName, CategoryError } from '@/domain/category';
import {
  createCategory,
  updateCategory,
  mergeCategory,
  CategoryStoreError,
  type CategoryInput,
  type CategoryKind,
} from '@/features/categories/store';
import {
  ClassificationStoreError,
  deleteClassificationRule,
  moveClassificationRuleDown,
  moveClassificationRuleUp,
  setClassificationRuleActive,
} from '@/features/classification/store';

export type CategoryFormState = {
  error: string | null;
};

const CATEGORY_KINDS: readonly CategoryKind[] = [
  'fixed_cost',
  'living',
  'sanctuary',
  'waste',
  'investment_spending',
  'repayment',
  'investment',
  'income',
  'transfer',
  'other',
];

function parseCategoryInput(formData: FormData): CategoryInput {
  const name = assertCategoryName(String(formData.get('name') ?? ''));

  const budgetRaw = String(formData.get('budgetYen') ?? '').trim();
  const budgetYen = assertCategoryBudgetYen(budgetRaw === '' ? null : Number(budgetRaw));

  return {
    name,
    budgetYen,
    showOnHome: formData.get('showOnHome') === 'on',
  };
}

function describeCategoryError(error: unknown): string {
  if (error instanceof CategoryError || error instanceof CategoryStoreError) {
    return error.message;
  }
  return '保存に失敗しました。入力内容を確認してください。';
}

export async function createCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  try {
    const input = parseCategoryInput(formData);
    const kindRaw = String(formData.get('kind') ?? '');
    if (!CATEGORY_KINDS.includes(kindRaw as CategoryKind)) {
      throw new CategoryError(`種類が不正です: ${kindRaw}`);
    }
    await createCategory({ ...input, kind: kindRaw as CategoryKind });
  } catch (error) {
    return { error: describeCategoryError(error) };
  }
  revalidatePath('/rules');
  revalidatePath('/');
  return { error: null };
}

export async function updateCategoryAction(
  id: string,
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  try {
    const input = parseCategoryInput(formData);
    await updateCategory(id, input);
  } catch (error) {
    return { error: describeCategoryError(error) };
  }
  revalidatePath('/rules');
  revalidatePath('/');
  return { error: null };
}

export async function mergeCategoryAction(
  id: string,
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const mergedIntoId = String(formData.get('mergedIntoId') ?? '');
  if (mergedIntoId === '') {
    return { error: '統合先のカテゴリを選んでください' };
  }
  try {
    await mergeCategory(id, mergedIntoId);
  } catch (error) {
    return { error: describeCategoryError(error) };
  }
  revalidatePath('/rules');
  revalidatePath('/');
  return { error: null };
}

export async function setRuleActiveAction(
  id: string,
  isActive: boolean,
): Promise<{ error: string | null }> {
  try {
    await setClassificationRuleActive(id, isActive);
  } catch (error) {
    return {
      error: error instanceof ClassificationStoreError ? error.message : '更新に失敗しました',
    };
  }
  revalidatePath('/rules');
  return { error: null };
}

export async function deleteRuleAction(id: string): Promise<{ error: string | null }> {
  try {
    await deleteClassificationRule(id);
  } catch (error) {
    return {
      error: error instanceof ClassificationStoreError ? error.message : '削除に失敗しました',
    };
  }
  revalidatePath('/rules');
  return { error: null };
}

export async function moveRuleUpAction(id: string): Promise<{ error: string | null }> {
  try {
    await moveClassificationRuleUp(id);
  } catch (error) {
    return {
      error: error instanceof ClassificationStoreError ? error.message : '並び替えに失敗しました',
    };
  }
  revalidatePath('/rules');
  return { error: null };
}

export async function moveRuleDownAction(id: string): Promise<{ error: string | null }> {
  try {
    await moveClassificationRuleDown(id);
  } catch (error) {
    return {
      error: error instanceof ClassificationStoreError ? error.message : '並び替えに失敗しました',
    };
  }
  revalidatePath('/rules');
  return { error: null };
}

'use server';

/**
 * 確認待ちキューでの1件修正から学習ルールを作る Server Action(M2-5)。
 *
 * 明細自体(分類の反映)はセッション保存のままクライアント側で完結する
 * (T-7 未着手)。ここが担うのは、学習ルールという DB 側の実体を作る部分だけ。
 */

import { RuleError } from '@/features/classification/rules';
import { ClassificationStoreError, createLearnedRule } from '@/features/classification/store';

export async function createLearnedRuleAction(
  description: string,
  categoryId: string,
): Promise<{ error: string | null }> {
  try {
    await createLearnedRule({ description, categoryId, accountId: null });
  } catch (error) {
    if (error instanceof RuleError || error instanceof ClassificationStoreError) {
      return { error: error.message };
    }
    return { error: '学習ルールの作成に失敗しました。' };
  }
  return { error: null };
}

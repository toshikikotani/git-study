/**
 * 取り込み画面(CSV / メール貼り付け)共通の「学習済みルールを取得する」呼び出し(M2-5)。
 *
 * `DEFAULT_DETECTION_RULES`(FR-21 の固定3件)だけでは、確認待ちキューでの
 * 修正から生まれた学習ルール(classification_rules, is_learned=true)が
 * 次回以降の取り込みに反映されない。ここで DB 保存分とカテゴリ名を取得し、
 * 呼び出し側で `DEFAULT_DETECTION_RULES` と合わせて `buildPreview()` に渡す
 * (カテゴリ名も一緒に返すのは、ルールが categoryId を設定してもプレビュー側は
 * id しか知らず「未分類」のまま表示されてしまうため)。
 */

import type { ClassificationRule } from '@/features/classification/rules';

export type FetchedRules = {
  rules: ClassificationRule[];
  categoryNameById: Map<string, string>;
};

const EMPTY: FetchedRules = { rules: [], categoryNameById: new Map() };

export async function fetchLearnedRules(): Promise<FetchedRules> {
  try {
    const response = await fetch('/api/classification-rules');
    if (!response.ok) return EMPTY;
    const data = (await response.json()) as {
      rules: ClassificationRule[];
      categories: { id: string; name: string }[];
    };
    return {
      rules: data.rules,
      categoryNameById: new Map(data.categories.map((c) => [c.id, c.name])),
    };
  } catch {
    return EMPTY;
  }
}

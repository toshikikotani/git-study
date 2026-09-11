/**
 * カテゴリの入力値検証と、統廃合(merged_into_id)の解決(FR-13, M2-6)。
 */

export class CategoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryError';
  }
}

/** カテゴリ名。空文字・空白のみは拒否する(ADR-016、本人がいつでも改名できる)。 */
export function assertCategoryName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new CategoryError('カテゴリ名を入力してください');
  }
  return trimmed;
}

/** 月次予算(円)。未設定(上限なし)は null、指定するなら0以上。 */
export function assertCategoryBudgetYen(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new CategoryError(`月次予算は0以上の整数で指定してください: ${value}`);
  }
  return value;
}

/** categories の統廃合(merged_into_id)を辿るために必要な最小限の形。 */
export type CategoryMergeNode = {
  id: string;
  mergedIntoId: string | null;
};

/**
 * 統合先を辿って行き着く先の id を返す。統合されていなければ自分自身。
 *
 * `ck_categories_not_self_merge` により1段の自己参照は DB が防ぐが、
 * 複数段の統合(A→B→C)で循環が生まれた場合の保険として、
 * 訪問済みの id に戻ってきたら打ち切る。
 */
export function resolveCategoryRoot(id: string, categories: readonly CategoryMergeNode[]): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let current = id;
  while (true) {
    if (seen.has(current)) return current;
    seen.add(current);
    const node = byId.get(current);
    if (!node || node.mergedIntoId === null) return current;
    current = node.mergedIntoId;
  }
}

/**
 * 集計対象のカテゴリ id 群(targetIds)へ、統合されて辿り着く旧カテゴリの
 * id もすべて足して返す。
 *
 * カテゴリを統合しても transactions.category_id は書き換えない
 * (docs/schema.sql の方針。削除ではなく付け替えで安全に統廃合する)ため、
 * 旧カテゴリの明細を新カテゴリの集計に含めるには、明細を読む側で
 * 「この新カテゴリに統合されている旧カテゴリはどれか」を逆引きする必要がある。
 */
export function expandMergedCategoryIds(
  categories: readonly CategoryMergeNode[],
  targetIds: readonly string[],
): string[] {
  const targetRoots = new Set(targetIds.map((id) => resolveCategoryRoot(id, categories)));
  const expanded = new Set<string>(targetIds);
  for (const category of categories) {
    if (targetRoots.has(resolveCategoryRoot(category.id, categories))) {
      expanded.add(category.id);
    }
  }
  return [...expanded];
}

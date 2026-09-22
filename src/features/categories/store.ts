/**
 * カテゴリ(categories)のデータアクセス(M2-6、FR-13)。
 *
 * 命名は docs/glossary.md の「レイヤーの命名」に従う(list/create/update)。
 * 使われたことのあるカテゴリは削除ではなく `mergeCategory()` で
 * is_active=false + merged_into_id へ付け替える(docs/schema.sql §3.3 の
 * コメントに明記)。一方、明細・分類ルールから一度も参照されていないカテゴリ
 * は `deleteCategory()` で本当に削除できる(本人発案:「編集できるけど
 * 削除できない」。P10-7)。
 */

import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export type CategoryKind = Database['public']['Enums']['category_kind'];

/** categories の1行(画面が必要とする部分)。 */
export type Category = {
  id: string;
  code: string;
  name: string;
  kind: CategoryKind;
  budgetYen: number | null;
  showOnHome: boolean;
  isActive: boolean;
  isSystem: boolean;
  mergedIntoId: string | null;
  sortOrder: number;
};

/** 新規作成・改名・予算変更で本人が入力する項目。kind は作成後は変更できない(UI 側の抑止)。 */
export type CategoryInput = {
  name: string;
  budgetYen: number | null;
  showOnHome: boolean;
};

export class CategoryStoreError extends AppError {}

type CategoryRow = Database['public']['Tables']['categories']['Row'];

function fromRow(row: CategoryRow): Category {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    budgetYen: row.default_monthly_budget_yen,
    showOnHome: row.show_on_home,
    isActive: row.is_active,
    isSystem: row.is_system,
    mergedIntoId: row.merged_into_id,
    sortOrder: row.sort_order,
  };
}

/** 統廃合済みも含めて全件返す(編集画面は統合済みカテゴリの行き先も表示するため)。 */
export async function listCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new CategoryStoreError(`カテゴリを取得できませんでした: ${error.message}`);
  return data.map(fromRow);
}

/** code は画面に出さない不変の識別子(ADR-016)。本人には入力させず自動発行する。 */
function generateCategoryCode(): string {
  return `custom_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export async function createCategory(
  input: CategoryInput & { kind: CategoryKind },
): Promise<Category> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new CategoryStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('categories')
    .insert({
      user_id: auth.user.id,
      code: generateCategoryCode(),
      name: input.name,
      kind: input.kind,
      default_monthly_budget_yen: input.budgetYen,
      show_on_home: input.showOnHome,
    })
    .select('*')
    .single();
  if (error) throw new CategoryStoreError(`カテゴリを作成できませんでした: ${error.message}`);
  return fromRow(data);
}

/** 改名・予算・ホーム表示枠の変更。kind・code は対象外(is_system の分岐を壊さないため)。 */
export async function updateCategory(id: string, input: CategoryInput): Promise<Category> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('categories')
    .update({
      name: input.name,
      default_monthly_budget_yen: input.budgetYen,
      show_on_home: input.showOnHome,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new CategoryStoreError(`カテゴリを更新できませんでした: ${error.message}`);
  return fromRow(data);
}

/**
 * 統廃合(FR-13)。旧カテゴリを is_active=false にし、merged_into_id で
 * 統合先を指す(`ck_categories_merged_inactive` が両方を同時に要求する)。
 * ホーム表示枠に残っていると統合後も show_on_home のまま非表示扱いになり
 * 紛らわしいため、統合と同時に false へ落とす。
 */
export async function mergeCategory(id: string, mergedIntoId: string): Promise<void> {
  if (id === mergedIntoId) {
    throw new CategoryStoreError('統合先には別のカテゴリを指定してください');
  }
  const supabase = await createClient();

  const { data: source, error: sourceError } = await supabase
    .from('categories')
    .select('id, is_system')
    .eq('id', id)
    .single();
  if (sourceError || !source) {
    throw new CategoryStoreError('統合するカテゴリが見つかりませんでした');
  }
  if (source.is_system) {
    throw new CategoryStoreError('システムが使うカテゴリは統合できません');
  }

  const { data: target, error: targetError } = await supabase
    .from('categories')
    .select('id, is_active')
    .eq('id', mergedIntoId)
    .single();
  if (targetError || !target || !target.is_active) {
    throw new CategoryStoreError('統合先には有効なカテゴリを指定してください');
  }

  const { error } = await supabase
    .from('categories')
    .update({ merged_into_id: mergedIntoId, is_active: false, show_on_home: false })
    .eq('id', id);
  if (error) throw new CategoryStoreError(`カテゴリを統合できませんでした: ${error.message}`);
}

/**
 * カテゴリの完全な削除(本人発案:「編集できるけど削除できない」)。
 *
 * 統廃合(mergeCategory)は「消さずに移行先を指す」ための機能で、使われた
 * ことのあるカテゴリを安全に片付ける手段としては正しいが、間違って作った・
 * 結局使わなかったカテゴリまで一覧に残り続けるのは別の不便さだった。
 * 一方で明細・分類ルールから参照されたまま削除すると、DB の外部キー
 * (docs/schema.sql §3.3)が transactions.category_id を NULL に、
 * classification_rules を CASCADE で消してしまい、本人の知らないうちに
 * 「未分類」化や意図しないルール消失が起きる。そのため、参照が1件でも
 * あれば削除させず、統合を促すメッセージを返す(壊れた状態を防ぐのではなく、
 * そもそも壊れる操作を実行させない)。
 */
export async function deleteCategory(id: string): Promise<void> {
  const supabase = await createClient();

  const { data: category, error: categoryError } = await supabase
    .from('categories')
    .select('id, is_system')
    .eq('id', id)
    .single();
  if (categoryError || !category) {
    throw new CategoryStoreError('削除するカテゴリが見つかりませんでした');
  }
  if (category.is_system) {
    throw new CategoryStoreError('システムが使うカテゴリは削除できません');
  }

  const [
    { data: transactions, error: txError },
    { data: splits, error: splitError },
    { data: rules, error: ruleError },
    { data: mergedFrom, error: mergedFromError },
  ] = await Promise.all([
    supabase.from('transactions').select('id').eq('category_id', id).limit(1),
    supabase.from('transaction_splits').select('id').eq('category_id', id).limit(1),
    supabase.from('classification_rules').select('id').eq('category_id', id).limit(1),
    supabase.from('categories').select('id').eq('merged_into_id', id).limit(1),
  ]);
  if (txError) throw new CategoryStoreError(`明細を確認できませんでした: ${txError.message}`);
  if (splitError) throw new CategoryStoreError(`明細を確認できませんでした: ${splitError.message}`);
  if (ruleError)
    throw new CategoryStoreError(`分類ルールを確認できませんでした: ${ruleError.message}`);
  if (mergedFromError) {
    throw new CategoryStoreError(`カテゴリを確認できませんでした: ${mergedFromError.message}`);
  }

  if (transactions.length > 0 || splits.length > 0) {
    throw new CategoryStoreError(
      'このカテゴリを使った明細があるため削除できません。統合をお使いください。',
    );
  }
  if (rules.length > 0) {
    throw new CategoryStoreError(
      'このカテゴリへの分類ルールがあるため削除できません。先にルールを削除するか変更してください。',
    );
  }
  if (mergedFrom.length > 0) {
    throw new CategoryStoreError('このカテゴリへ統合済みのカテゴリがあるため削除できません。');
  }

  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw new CategoryStoreError(`カテゴリを削除できませんでした: ${error.message}`);
}

/**
 * カテゴリ(categories)のデータアクセス(M2-6、FR-13)。
 *
 * 命名は docs/glossary.md の「レイヤーの命名」に従う(list/create/update)。
 * 削除は無い:budgets・classification_rules・transactions から参照されたまま
 * 安全に統廃合するため、`mergeCategory()` で is_active=false + merged_into_id
 * へ付け替える方針(docs/schema.sql §3.3 のコメントに明記)。
 */

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

export class CategoryStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryStoreError';
  }
}

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

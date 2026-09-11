/**
 * AI 分類(M2-4)を実際のカテゴリ・設定に接続する層(M2-3b)。
 *
 * `features/classification/{rules,ai}.ts` はどちらも純粋関数で、DB にも
 * ネットワークにも触れない(テストしやすさのため意図的にそうしてある)。
 * ここが唯一、Supabase(カテゴリ・確信度の閾値)と Anthropic API の両方に
 * 触れる場所。
 *
 * ANTHROPIC_API_KEY が未設定でもアプリは動く(エラーにしない)。ルールに
 * 当たらなかった明細は「確認待ち」のまま残るだけ(Gmail 連携・メール貼り付け
 * の AI 救済と同じ考え方)。
 */
import 'server-only';

import {
  applyConfidenceThreshold,
  ClaudeTransactionClassifier,
  type ClassifiableTransaction,
} from '@/features/classification/ai';
import { buildLearnedRule, type ClassificationRule } from '@/features/classification/rules';
import { getAppSettings } from '@/features/settings/store';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export type CategoryOption = { id: string; code: string; name: string };

export class ClassificationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassificationStoreError';
  }
}

/** 有効なカテゴリ。AI へは code + name のみ渡す(ADR-016)。 */
export async function listCategoryOptions(): Promise<CategoryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('categories')
    .select('id, code, name')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) {
    throw new ClassificationStoreError(`カテゴリを取得できませんでした: ${error.message}`);
  }
  return data;
}

export type ClassifyResult = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  classifiedBy: 'ai' | 'unclassified';
  reviewStatus: 'auto_ok' | 'pending';
};

function unclassified(id: string): ClassifyResult {
  return {
    id,
    categoryId: null,
    categoryName: null,
    classifiedBy: 'unclassified',
    reviewStatus: 'pending',
  };
}

/**
 * ルールに当たらなかった明細を AI に回す。
 *
 * バッチが失敗した行(AI からの返答が無い行)も「確認待ち」のまま返す。
 * 黙って落とさない(NFR-06)。
 */
export async function classifyUnclassified(
  rows: readonly ClassifiableTransaction[],
): Promise<{ results: ClassifyResult[]; warnings: string[] }> {
  if (rows.length === 0) return { results: [], warnings: [] };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    return {
      results: rows.map((row) => unclassified(row.id)),
      warnings: ['AI による分類は設定されていません(ANTHROPIC_API_KEY が未設定)。'],
    };
  }

  const [categories, settings] = await Promise.all([listCategoryOptions(), getAppSettings()]);
  const byCode = new Map(categories.map((category) => [category.code, category]));

  const classifier = new ClaudeTransactionClassifier(apiKey);
  const outcome = await classifier.classifyMany(
    rows,
    categories.map((category) => ({ code: category.code, name: category.name })),
  );

  const results = outcome.classifications.map((classification) => {
    const applied = applyConfidenceThreshold(
      classification,
      settings.classificationConfidenceThreshold,
    );
    const category = applied.categoryCode ? byCode.get(applied.categoryCode) : undefined;
    return {
      id: classification.transactionId,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      classifiedBy: applied.classifiedBy,
      reviewStatus: applied.reviewStatus,
    };
  });

  // バッチ全体が失敗した回など、AI が結果を返さなかった行も確認待ちのまま返す
  const returnedIds = new Set(results.map((result) => result.id));
  const missing = rows.filter((row) => !returnedIds.has(row.id)).map((row) => unclassified(row.id));

  return { results: [...results, ...missing], warnings: outcome.warnings };
}

type ClassificationRuleRow = Database['public']['Tables']['classification_rules']['Row'];

function ruleFromRow(row: ClassificationRuleRow): ClassificationRule {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority,
    matchType: row.match_type,
    pattern: row.pattern ?? undefined,
    accountId: row.account_id ?? undefined,
    minAmountYen: row.min_amount_yen ?? undefined,
    maxAmountYen: row.max_amount_yen ?? undefined,
    categoryId: row.category_id ?? undefined,
    setPaymentMethod: row.set_payment_method ?? undefined,
    setMerchantName: row.set_merchant_name ?? undefined,
    isActive: row.is_active,
  };
}

/**
 * DB 保存の分類ルール(手書き + 学習済み)。取り込み経路は
 * `DEFAULT_DETECTION_RULES`(FR-21 の検知、固定3件)とこれを両方渡して
 * `applyRules()` を呼ぶ(M2-5)。
 */
export async function listActiveClassificationRules(): Promise<ClassificationRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('classification_rules')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (error) {
    throw new ClassificationStoreError(`分類ルールを取得できませんでした: ${error.message}`);
  }
  return data.map(ruleFromRow);
}

export type ClassificationRuleSummary = {
  id: string;
  name: string;
  priority: number;
  matchType: ClassificationRuleRow['match_type'];
  pattern: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isLearned: boolean;
  isActive: boolean;
  hitCount: number;
  lastHitAt: string | null;
};

/**
 * 分類ルールの一覧・編集画面(M2-6)向け。無効化済みも含めて全件返す
 * (`listActiveClassificationRules()` は取り込み経路が使う有効分のみ)。
 * カテゴリ名は `categories.name` から解決する(ADR-016、code では画面に出さない)。
 */
export async function listClassificationRules(): Promise<ClassificationRuleSummary[]> {
  const supabase = await createClient();
  const [{ data: rules, error: rulesError }, { data: categories, error: categoriesError }] =
    await Promise.all([
      supabase.from('classification_rules').select('*').order('priority', { ascending: true }),
      supabase.from('categories').select('id, name'),
    ]);
  if (rulesError) {
    throw new ClassificationStoreError(`分類ルールを取得できませんでした: ${rulesError.message}`);
  }
  if (categoriesError) {
    throw new ClassificationStoreError(
      `カテゴリを取得できませんでした: ${categoriesError.message}`,
    );
  }

  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  return rules.map((row) => ({
    id: row.id,
    name: row.name,
    priority: row.priority,
    matchType: row.match_type,
    pattern: row.pattern,
    categoryId: row.category_id,
    categoryName: row.category_id ? (nameById.get(row.category_id) ?? null) : null,
    isLearned: row.is_learned,
    isActive: row.is_active,
    hitCount: row.hit_count,
    lastHitAt: row.last_hit_at,
  }));
}

export async function setClassificationRuleActive(id: string, isActive: boolean): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('classification_rules')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) {
    throw new ClassificationStoreError(`分類ルールを更新できませんでした: ${error.message}`);
  }
}

export async function deleteClassificationRule(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('classification_rules').delete().eq('id', id);
  if (error) {
    throw new ClassificationStoreError(`分類ルールを削除できませんでした: ${error.message}`);
  }
}

/**
 * 隣り合う2件の priority を入れ替える。transfer_rules(M4-3)と違い
 * 一意制約がないため、負の一時値を経由させる必要はない。
 */
async function swapRulePriority(
  a: { id: string; priority: number },
  b: { id: string; priority: number },
): Promise<void> {
  const supabase = await createClient();

  const step = async (id: string, priority: number) => {
    const { error } = await supabase.from('classification_rules').update({ priority }).eq('id', id);
    if (error) throw new ClassificationStoreError(`並び替えに失敗しました: ${error.message}`);
  };

  await step(a.id, b.priority);
  await step(b.id, a.priority);
}

/** 1つ上(priority がより小さい方)のルールと順序を入れ替える。先頭なら何もしない。 */
export async function moveClassificationRuleUp(id: string): Promise<void> {
  const rules = await listClassificationRules();
  const index = rules.findIndex((r) => r.id === id);
  if (index <= 0) return;
  await swapRulePriority(rules[index]!, rules[index - 1]!);
}

/** 1つ下(priority がより大きい方)のルールと順序を入れ替える。末尾なら何もしない。 */
export async function moveClassificationRuleDown(id: string): Promise<void> {
  const rules = await listClassificationRules();
  const index = rules.findIndex((r) => r.id === id);
  if (index === -1 || index >= rules.length - 1) return;
  await swapRulePriority(rules[index]!, rules[index + 1]!);
}

/**
 * 確認待ちキューでの1件修正から学習ルールを作る(FR-12, M2-5)。
 *
 * 明細はセッション保存のまま(T-7 未着手)で DB の行を持たないため、
 * learned_from_transaction_id は null のままにする(このルート自体は
 * 任意の FK なので問題ない)。
 */
export async function createLearnedRule(params: {
  description: string;
  categoryId: string;
  accountId: string | null;
}): Promise<void> {
  const built = buildLearnedRule({
    id: '',
    description: params.description,
    categoryId: params.categoryId,
    accountId: params.accountId ?? undefined,
    fromTransactionId: '',
  });

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new ClassificationStoreError('ログイン状態を確認できませんでした');
  }

  const { error } = await supabase.from('classification_rules').insert({
    user_id: auth.user.id,
    name: built.name,
    priority: built.priority,
    match_type: built.matchType,
    pattern: built.pattern ?? null,
    account_id: built.accountId ?? null,
    category_id: built.categoryId ?? null,
    is_learned: true,
    is_active: true,
  });
  if (error) {
    throw new ClassificationStoreError(`学習ルールを作成できませんでした: ${error.message}`);
  }
}

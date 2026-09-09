/**
 * 給料日振替ルール(transfer_rules)のデータアクセス(M4-3、FR-15)。
 *
 * 命名は docs/glossary.md の「レイヤーの命名」に従う(list/create/update/delete)。
 * 対象は当面 trigger='payday' のみ(side_income は FR-42、フェーズ2)。
 *
 * ── 並び替えについて ─────────────────────────────────────────
 * `ux_transfer_rules_order`(user_id, trigger, execution_order の一意制約、
 * is_active のみ対象)があるため、隣り合う2件の順序を単純に入れ替えると
 * 一時的に重複する。負の一時値を経由させることで衝突を避ける。
 */

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export type AmountType = Database['public']['Enums']['transfer_amount_type'];
export type TransferTrigger = Database['public']['Enums']['transfer_trigger'];

export type TransferRule = {
  id: string;
  name: string;
  executionOrder: number;
  amountType: AmountType;
  amountYen: number | null;
  percentage: number | null;
  toAccountId: string | null;
  categoryId: string | null;
  note: string | null;
};

export type TransferRuleInput = {
  name: string;
  amountType: AmountType;
  amountYen: number | null;
  percentage: number | null;
  toAccountId: string | null;
  categoryId: string | null;
  note: string | null;
};

/** フォームの選択肢用の最小限の形。 */
export type CategoryOption = { id: string; name: string };

export class TransferRuleStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferRuleStoreError';
  }
}

type TransferRuleRow = Database['public']['Tables']['transfer_rules']['Row'];

function fromRow(row: TransferRuleRow): TransferRule {
  return {
    id: row.id,
    name: row.name,
    executionOrder: row.execution_order,
    amountType: row.amount_type,
    amountYen: row.amount_yen,
    percentage: row.percentage,
    toAccountId: row.to_account_id,
    categoryId: row.category_id,
    note: row.note,
  };
}

const PAYDAY: TransferTrigger = 'payday';

export async function listTransferRules(): Promise<TransferRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transfer_rules')
    .select('*')
    .eq('trigger', PAYDAY)
    .eq('is_active', true)
    .order('execution_order', { ascending: true });

  if (error) throw new TransferRuleStoreError(`振替ルールを取得できませんでした: ${error.message}`);
  return data.map(fromRow);
}

/** 有効なカテゴリの選択肢。表示名は categories.name(ADR-016)。 */
export async function listCategoryOptions(): Promise<CategoryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('categories')
    .select('id, name')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw new TransferRuleStoreError(`カテゴリを取得できませんでした: ${error.message}`);
  return data;
}

/** 新規作成時の実行順序。既存の最大値の次に置く(末尾に追加)。 */
async function nextExecutionOrder(): Promise<number> {
  const rules = await listTransferRules();
  return rules.reduce((max, r) => Math.max(max, r.executionOrder), 0) + 1;
}

export async function createTransferRule(input: TransferRuleInput): Promise<TransferRule> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new TransferRuleStoreError('ログイン状態を確認できませんでした');
  }

  const executionOrder = await nextExecutionOrder();

  const { data, error } = await supabase
    .from('transfer_rules')
    .insert({
      user_id: auth.user.id,
      name: input.name,
      trigger: PAYDAY,
      execution_order: executionOrder,
      amount_type: input.amountType,
      amount_yen: input.amountYen,
      percentage: input.percentage,
      to_account_id: input.toAccountId,
      category_id: input.categoryId,
      note: input.note,
    })
    .select('*')
    .single();

  if (error) throw new TransferRuleStoreError(describeConstraint(error.message));
  return fromRow(data);
}

export async function updateTransferRule(
  id: string,
  input: TransferRuleInput,
): Promise<TransferRule> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transfer_rules')
    .update({
      name: input.name,
      amount_type: input.amountType,
      amount_yen: input.amountYen,
      percentage: input.percentage,
      to_account_id: input.toAccountId,
      category_id: input.categoryId,
      note: input.note,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new TransferRuleStoreError(describeConstraint(error.message));
  return fromRow(data);
}

export async function deleteTransferRule(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('transfer_rules').delete().eq('id', id);
  if (error) throw new TransferRuleStoreError(`振替ルールを削除できませんでした: ${error.message}`);
}

/**
 * 隣り合う2件の execution_order を入れ替える。
 * 一意制約に一時的に触れないよう、負の値を経由させる。
 */
async function swapExecutionOrder(a: TransferRule, b: TransferRule): Promise<void> {
  const supabase = await createClient();

  const step = async (id: string, order: number) => {
    const { error } = await supabase
      .from('transfer_rules')
      .update({ execution_order: order })
      .eq('id', id);
    if (error) throw new TransferRuleStoreError(`並び替えに失敗しました: ${error.message}`);
  };

  await step(a.id, -1);
  await step(b.id, a.executionOrder);
  await step(a.id, b.executionOrder);
}

/** 1つ上のルールと順序を入れ替える。先頭なら何もしない。 */
export async function moveTransferRuleUp(id: string): Promise<void> {
  const rules = await listTransferRules();
  const index = rules.findIndex((r) => r.id === id);
  if (index <= 0) return;
  await swapExecutionOrder(rules[index]!, rules[index - 1]!);
}

/** 1つ下のルールと順序を入れ替える。末尾なら何もしない。 */
export async function moveTransferRuleDown(id: string): Promise<void> {
  const rules = await listTransferRules();
  const index = rules.findIndex((r) => r.id === id);
  if (index === -1 || index >= rules.length - 1) return;
  await swapExecutionOrder(rules[index]!, rules[index + 1]!);
}

/** DB 制約違反を本人に伝わる文言にする。それ以外はそのまま返す。 */
function describeConstraint(message: string): string {
  if (message.includes('ux_transfer_rules_remainder')) {
    return '「残り全額」を指定するルールは、同じ契機に1件までです。';
  }
  if (message.includes('ux_transfer_rules_user_name')) {
    return 'すでに同じ名前のルールがあります。';
  }
  if (message.includes('ck_transfer_rules_different_accounts')) {
    return '振込元と振込先には別の口座を指定してください。';
  }
  return `振替ルールを保存できませんでした: ${message}`;
}

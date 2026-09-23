/**
 * レシートの品目(receipt_items)のデータアクセス(ADR-034/035/036)。
 *
 * `transaction_splits`(カテゴリ分割)とは独立している。品目は分割の対象に
 * なるかどうかに関わらず、常に付く記録(合計の一致は求めない)。カテゴリ
 * (category_id)も分割とは別に品目単体へ付けられる(ADR-035)。商品の種類
 * そのもの(product_type)は固定カテゴリとは別の、AIの自由記述(ADR-036)。
 *
 * `receipt_items` は本番未適用。未適用時の扱いは lib/supabase/errors.ts
 * (読み取りは「品目はまだ無い」として握り潰す。保存は本人の明示的な操作
 * =レシート取り込みの一部だが、取り込み自体は失敗させず警告に留める、
 * receipt/page.tsx 参照)。
 *
 * `category_id`・`product_type` はどちらも receipt_items 自体より後に
 * 追加した列で、本番未適用(B-17/B-18)。同じタイミングで足した列なので
 * まとめて1つの「後発の列」として扱い、片方だけ落として片方だけ保存する
 * ような細かい組み合わせは持たない(2列×2列の総当たりは複雑さに見合わない
 * ——本人は apply-pending.sql で複数マイグレーションをまとめて適用する
 * 運用のため、実際には同時に反映される)。列付きで失敗したら両方外して
 * 再試行する(features/transactions/store.ts の receipt_image_path と
 * 同じ考え方、列版)。
 */

import { assertEditableReceiptItems, ReceiptItemsError } from '@/domain/receipt-items';
import { AppError } from '@/lib/errors';
import { isMissingColumnError, isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export class ReceiptItemStoreError extends AppError {}

export type ReceiptItemInput = {
  name: string;
  amountYen: number;
  categoryId?: string | null;
  productType?: string | null;
};

function baseRow(item: ReceiptItemInput, userId: string, transactionId: string, sortOrder: number) {
  return {
    user_id: userId,
    transaction_id: transactionId,
    name: item.name,
    amount_yen: item.amountYen,
    sort_order: sortOrder,
  };
}

/**
 * 品目をまるごと置き換える(既存の全行を削除し、新しい内容で作り直す)。
 * 空配列を渡すと品目を無くす(取り込み直後の再保存・訂正を想定)。
 *
 * 分割(`assertValidSplits`)と違い、合計が明細の金額と一致することは
 * 求めない(一致しないまま保存してよい設計、本人発案)。
 */
export async function replaceReceiptItems(
  transactionId: string,
  items: readonly ReceiptItemInput[],
): Promise<void> {
  if (items.length > 0) {
    try {
      assertEditableReceiptItems(items);
    } catch (error) {
      if (error instanceof ReceiptItemsError) {
        throw new ReceiptItemStoreError(error.message);
      }
      throw error;
    }
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new ReceiptItemStoreError('ログイン状態を確認できませんでした');
  }

  const { error: deleteError } = await supabase
    .from('receipt_items')
    .delete()
    .eq('transaction_id', transactionId);
  if (deleteError) {
    if (isMissingTableError(deleteError)) {
      throw new ReceiptItemStoreError('品目の記録機能はまだ利用できません');
    }
    throw new ReceiptItemStoreError(`既存の品目を削除できませんでした: ${deleteError.message}`);
  }

  if (items.length === 0) return;

  const rowsWithExtras = items.map((item, i) => ({
    ...baseRow(item, auth.user.id, transactionId, i),
    category_id: item.categoryId ?? null,
    product_type: item.productType ?? null,
  }));
  let insertError = (await supabase.from('receipt_items').insert(rowsWithExtras)).error;
  if (insertError && isMissingColumnError(insertError)) {
    const rowsWithoutExtras = items.map((item, i) => baseRow(item, auth.user.id, transactionId, i));
    insertError = (await supabase.from('receipt_items').insert(rowsWithoutExtras)).error;
  }
  if (insertError) {
    if (isMissingTableError(insertError)) {
      throw new ReceiptItemStoreError('品目の記録機能はまだ利用できません');
    }
    throw new ReceiptItemStoreError(`品目を保存できませんでした: ${insertError.message}`);
  }
}

export type ReceiptItem = {
  id: string;
  name: string;
  amountYen: number;
  categoryId: string | null;
  categoryName: string | null;
  productType: string | null;
};

/**
 * 一覧画面向け:表示中の明細群の品目をまとめて読む(splits-store.ts の
 * listSplitsForDisplay() と同じパターン、1明細ずつ問い合わせない)。
 */
export async function listReceiptItemsForTransactionIds(
  transactionIds: readonly string[],
): Promise<Map<string, ReceiptItem[]>> {
  const map = new Map<string, ReceiptItem[]>();
  if (transactionIds.length === 0) return map;

  const supabase = await createClient();
  let rows: {
    id: string;
    transaction_id: string;
    name: string;
    amount_yen: number;
    category_id: string | null;
    product_type: string | null;
  }[];
  const withExtras = await supabase
    .from('receipt_items')
    .select('id, transaction_id, name, amount_yen, category_id, product_type')
    .in('transaction_id', transactionIds)
    .order('sort_order', { ascending: true });
  if (withExtras.error && isMissingColumnError(withExtras.error)) {
    const withoutExtras = await supabase
      .from('receipt_items')
      .select('id, transaction_id, name, amount_yen')
      .in('transaction_id', transactionIds)
      .order('sort_order', { ascending: true });
    if (withoutExtras.error) {
      if (isMissingTableError(withoutExtras.error)) return map;
      throw new ReceiptItemStoreError(`品目を取得できませんでした: ${withoutExtras.error.message}`);
    }
    rows = withoutExtras.data.map((r) => ({ ...r, category_id: null, product_type: null }));
  } else if (withExtras.error) {
    if (isMissingTableError(withExtras.error)) return map;
    throw new ReceiptItemStoreError(`品目を取得できませんでした: ${withExtras.error.message}`);
  } else {
    rows = withExtras.data;
  }
  if (rows.length === 0) return map;

  const { data: categories, error: categoriesError } = await supabase
    .from('categories')
    .select('id, name');
  if (categoriesError) {
    throw new ReceiptItemStoreError(`カテゴリを取得できませんでした: ${categoriesError.message}`);
  }
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  for (const row of rows) {
    const list = map.get(row.transaction_id) ?? [];
    const categoryId = row.category_id ?? null;
    list.push({
      id: row.id,
      name: row.name,
      amountYen: row.amount_yen,
      categoryId,
      categoryName: categoryId ? (categoryNameById.get(categoryId) ?? null) : null,
      productType: row.product_type ?? null,
    });
    map.set(row.transaction_id, list);
  }
  return map;
}

/**
 * レシートの品目の読み取りミスを探す・直す(ADR-120)。探すのは読むだけで、直すのは本人が選んで
 * 押したレシートだけ。直すときは、探したときの品目から変わっていないことを確かめてから置き換える
 * (品目は置き換えるたびに作り直すため、品目の id の並びで確かめられる)。
 */

import { z } from 'zod';

import {
  receiptCheckGroups,
  ruleReceiptFixes,
  type ReceiptCheckEntry,
  type ReceiptCheckGroup,
} from '@/domain/receipt-check';
import { apiKeyMissingMessage } from '@/lib/anthropic';
import { mapChunks } from '@/lib/chunk';
import { readAnthropicApiKey } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { isMissingColumnError, isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import { listReceiptItemsForTransactionIds, replaceReceiptItems } from './items-store';
import { findReceiptMistakesWithAi, MAX_AI_RECEIPTS } from './receipt-check-ai';

export class ReceiptCheckError extends AppError {}

/** 最近のレシートを探すときに読む品目の行数(この中に出てくるレシートから、新しいものを選ぶ)。 */
const RECENT_ITEM_ROWS = 3000;

type TransactionRow = {
  id: string;
  occurred_on: string;
  amount_yen: number;
  merchant_name: string | null;
  description: string;
  reconcile_diff_yen?: number | null;
};

/** 品目のある最近のレシート(振替・対象外を除く、新しい順)。 */
export async function loadReceiptCheckEntries(
  limit = MAX_AI_RECEIPTS,
): Promise<ReceiptCheckEntry[]> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new ReceiptCheckError('ログイン状態を確認できませんでした。');

  const recent = await supabase
    .from('receipt_items')
    .select('transaction_id, created_at')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .range(0, RECENT_ITEM_ROWS - 1);
  if (recent.error) {
    if (isMissingTableError(recent.error)) return [];
    throw new ReceiptCheckError('レシートの品目を取得できませんでした。');
  }
  const ids = [...new Set(recent.data.map((row) => row.transaction_id))].slice(0, limit);
  if (ids.length === 0) return [];

  const chunks = await mapChunks(ids, async (chunk): Promise<TransactionRow[]> => {
    const select = (columns: string) =>
      supabase
        .from('transactions')
        .select(columns)
        .eq('user_id', auth.user.id)
        .in('id', chunk)
        .eq('is_transfer', false)
        .neq('review_status', 'ignored');
    const base = 'id, occurred_on, amount_yen, merchant_name, description';
    let result = await select(`${base}, reconcile_diff_yen`);
    if (result.error && isMissingColumnError(result.error)) result = await select(base);
    if (result.error) throw new ReceiptCheckError('レシートの明細を取得できませんでした。');
    return result.data as unknown as TransactionRow[];
  });
  const transactions = chunks
    .flat()
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || a.id.localeCompare(b.id));
  const items = await listReceiptItemsForTransactionIds(transactions.map((t) => t.id));

  return transactions.flatMap((t): ReceiptCheckEntry[] => {
    const list = items.get(t.id) ?? [];
    if (list.length === 0) return [];
    return [
      {
        transactionId: t.id,
        occurredOn: t.occurred_on,
        amountYen: t.amount_yen,
        storeName: t.merchant_name?.trim() || t.description,
        reconcileDiffYen: t.reconcile_diff_yen ?? null,
        items: list.map((item) => ({
          id: item.id,
          name: item.name,
          amountYen: item.amountYen,
          genreId: item.genreId,
          productType: item.productType,
        })),
      },
    ];
  });
}

/**
 * 最近のレシートの読み取りミスを、規則と AI で探す(本人が押したときだけ)。AI が使えない・失敗した
 * ときは規則の候補だけを返し、理由を warning に入れる。読むだけで、何も書き換えない。
 */
export async function scanReceipts(): Promise<{
  groups: ReceiptCheckGroup[];
  warning: string | null;
}> {
  const entries = await loadReceiptCheckEntries();
  if (entries.length === 0) return { groups: [], warning: null };
  const rule = entries.flatMap(ruleReceiptFixes);
  const apiKey = readAnthropicApiKey();
  if (apiKey === null) {
    return {
      groups: receiptCheckGroups(entries, rule),
      warning: apiKeyMissingMessage('AIのレシートチェック'),
    };
  }
  const ai = await findReceiptMistakesWithAi(entries, apiKey);
  return { groups: receiptCheckGroups(entries, [...ai.fixes, ...rule]), warning: ai.warning };
}

const id = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const fixSchema = z.object({
  transactionId: id,
  expectedItemIds: z.array(id).min(1).max(500),
  items: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[^\p{Cc}\p{Cf}]+$/u),
        amountYen: z
          .number()
          .int()
          .refine((yen) => yen !== 0 && Math.abs(yen) <= 1_000_000_000),
        genreId: z.string().max(100).nullable(),
        productType: z.string().max(200).nullable(),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * 本人が確かめた品目で置き換える。探したときから品目が変わっていたら(別の画面で直した・
 * 取り込み直したなど)保存しない。
 */
export async function saveReceiptItemFix(input: unknown): Promise<void> {
  const parsed = fixSchema.safeParse(input);
  if (!parsed.success) throw new ReceiptCheckError('品目の名前と金額を確認してください。');
  const { transactionId, expectedItemIds, items } = parsed.data;
  const current = (await listReceiptItemsForTransactionIds([transactionId])).get(transactionId);
  const currentIds = (current ?? []).map((item) => item.id);
  if (
    currentIds.length !== expectedItemIds.length ||
    currentIds.some((itemId, i) => itemId !== expectedItemIds[i])
  ) {
    throw new ReceiptCheckError('品目が変更されています。閉じてからもう一度確かめてください。');
  }
  await replaceReceiptItems(transactionId, items);
}

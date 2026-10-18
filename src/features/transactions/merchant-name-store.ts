import { z } from 'zod';

import {
  groupMerchantNameReview,
  type MerchantNameReviewGroup,
  type MerchantNameSnapshot,
} from '@/domain/merchant-name-review';
import { AppError } from '@/lib/errors';
import { todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

export type {
  MerchantNameReviewEntry,
  MerchantNameReviewGroup,
  MerchantNameReviewReason,
  MerchantNameSnapshot,
} from '@/domain/merchant-name-review';

export class MerchantNameStoreError extends AppError {}

export type MerchantNameChange = {
  snapshot: MerchantNameSnapshot;
  name: string;
  branchName: string | null;
};

export type MerchantNameSaveResult = {
  updatedIds: string[];
  failed: { id: string; error: string }[];
  error: string | null;
};

export const MAX_MERCHANT_NAME_CHANGES = 100;
const PAGE_SIZE = 1000;
const nameValue = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u);
const changesSchema = z.object({
  changes: z
    .array(
      z.object({
        snapshot: z.object({
          id: z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i),
          merchantName: z.string().max(10_000).nullable(),
          description: z.string().max(10_000),
          branchName: z.string().max(10_000).nullable(),
          updatedAt: z
            .string()
            .max(100)
            .refine((value) => Number.isFinite(Date.parse(value))),
        }),
        name: nameValue,
        branchName: nameValue.nullable(),
      }),
    )
    .min(1)
    .max(MAX_MERCHANT_NAME_CHANGES)
    .refine(
      (changes) => new Set(changes.map((change) => change.snapshot.id)).size === changes.length,
    ),
});

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new MerchantNameStoreError('ログイン状態を確認できませんでした。');
  return { supabase, userId: data.user.id };
}

/** 月をまたぐ表記ゆれも、本人の実績明細からまとめて確認できる。 */
export async function listMerchantNameReviewGroups(): Promise<MerchantNameReviewGroup[]> {
  const { supabase, userId } = await authenticatedClient();
  const today = todayJst();
  const entries = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, merchant_name, description, branch_name, updated_at, occurred_on, amount_yen')
      .eq('user_id', userId)
      .lte('occurred_on', today)
      .eq('is_transfer', false)
      .neq('review_status', 'ignored')
      .order('occurred_on', { ascending: false })
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new MerchantNameStoreError('店名の確認候補を取得できませんでした。');
    entries.push(
      ...data.map((row) => ({
        id: row.id,
        merchantName: row.merchant_name,
        description: row.description,
        branchName: row.branch_name,
        updatedAt: row.updated_at,
        occurredOn: row.occurred_on,
        amountYen: row.amount_yen,
      })),
    );
    if (data.length < PAGE_SIZE) break;
  }
  return groupMerchantNameReview(entries);
}

/**
 * 対象と修正後の名前は本人が確認して送る。金額・日付・カテゴリ・原文は変更しない。
 * 複数件を1件ずつCAS更新し、競合や通信失敗も含めて未保存のIDを必ず返す。
 */
export async function saveMerchantNameChanges(input: unknown): Promise<MerchantNameSaveResult> {
  const { supabase, userId } = await authenticatedClient();
  const parsed = changesSchema.safeParse(input);
  if (!parsed.success)
    throw new MerchantNameStoreError(
      '店名・支店名と対象の明細を確認してください。一度に100件まで保存できます。',
    );
  const result: MerchantNameSaveResult = { updatedIds: [], failed: [], error: null };
  const today = todayJst();
  for (const { snapshot, name, branchName } of parsed.data.changes) {
    try {
      let query = supabase
        .from('transactions')
        .update({ merchant_name: name, branch_name: branchName })
        .eq('user_id', userId)
        .eq('id', snapshot.id)
        .lte('occurred_on', today)
        .eq('is_transfer', false)
        .neq('review_status', 'ignored')
        .eq('description', snapshot.description)
        .eq('updated_at', snapshot.updatedAt);
      query =
        snapshot.merchantName === null
          ? query.is('merchant_name', null)
          : query.eq('merchant_name', snapshot.merchantName);
      query =
        snapshot.branchName === null
          ? query.is('branch_name', null)
          : query.eq('branch_name', snapshot.branchName);
      const { data, error } = await query.select('id').maybeSingle();
      if (error)
        result.failed.push({
          id: snapshot.id,
          error: '店名を保存できませんでした。もう一度お試しください。',
        });
      else if (!data)
        result.failed.push({
          id: snapshot.id,
          error: '明細が変更されています。読み込み直して確認してください。',
        });
      else result.updatedIds.push(data.id);
    } catch {
      result.failed.push({
        id: snapshot.id,
        error: '店名を保存できませんでした。通信状態を確認して、もう一度お試しください。',
      });
    }
  }
  return result;
}

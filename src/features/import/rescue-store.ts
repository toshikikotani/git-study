/**
 * AI救済メールの保存(T-11、ADR-019)。
 *
 * ラベル辞書(email.ts)で読めず AI に回ったメールの本文をここに残す。
 * `docs/decisions.md` ADR-019 が「AI に回った本文を残しておけば、辞書に
 * 語を足して費用ゼロの経路へ戻せる」と述べている仕組みの実体。
 *
 * 記録の失敗は取り込み本体を止めてはならない(呼び出し側で必ず
 * `.catch()` すること)。あくまで後から辞書を育てるための副次的な記録。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export class RescuedEmailStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RescuedEmailStoreError';
  }
}

export type RescuedEmailSource = Database['public']['Enums']['transaction_source'];

export type RescuedEmailInput = {
  source: RescuedEmailSource;
  subject: string | null;
  body: string;
  /** AI が読み取れた明細数。0なら AI も読めなかったことを意味する。 */
  extractedCount: number;
};

export async function recordRescuedEmailAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  input: RescuedEmailInput,
): Promise<void> {
  const { error } = await client.from('rescued_emails').insert({
    user_id: userId,
    source: input.source,
    subject: input.subject,
    body: input.body,
    extracted_count: input.extractedCount,
  });
  if (error)
    throw new RescuedEmailStoreError(`AI救済メールを保存できませんでした: ${error.message}`);
}

export type RescuedEmail = {
  id: string;
  source: RescuedEmailSource;
  subject: string | null;
  body: string;
  extractedCount: number;
  createdAt: string;
};

/** 直近のAI救済メールを新しい順に返す(辞書を育てるための見直し画面)。 */
export async function listRescuedEmails(limit = 30): Promise<RescuedEmail[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('rescued_emails')
    .select('id, source, subject, body, extracted_count, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new RescuedEmailStoreError(`一覧を取得できませんでした: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    source: row.source,
    subject: row.subject,
    body: row.body,
    extractedCount: row.extracted_count,
    createdAt: row.created_at,
  }));
}

export async function deleteRescuedEmail(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('rescued_emails').delete().eq('id', id);
  if (error) throw new RescuedEmailStoreError(`削除できませんでした: ${error.message}`);
}

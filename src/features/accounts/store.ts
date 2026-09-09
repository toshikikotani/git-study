/**
 * 口座(accounts)のデータアクセス(M6-1)。
 *
 * 命名は docs/glossary.md の「レイヤーの命名」に従う(list/create/update)。
 * RLS が本人の行だけに絞る(ADR-011)ので、SELECT 側で user_id を
 * 意識する必要はない。INSERT だけは呼び出し側の user_id を明示する
 * 必要がある(RLS の WITH CHECK は自動補完してくれない)。
 */

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export type AccountKind = Database['public']['Enums']['account_kind'];
export type AccountPurpose = Database['public']['Enums']['account_purpose'];

/** accounts の1行(画面が必要とする部分)。 */
export type Account = {
  id: string;
  name: string;
  institutionName: string | null;
  kind: AccountKind;
  purpose: AccountPurpose;
  /** クレジットカードの締め日(1〜31)。銀行口座・現金は null。 */
  closingDay: number | null;
  /** 支払日(1〜31)。 */
  paymentDay: number | null;
  isActive: boolean;
  note: string | null;
};

/** 新規作成・更新で本人が入力する項目。 */
export type AccountInput = {
  name: string;
  institutionName: string | null;
  kind: AccountKind;
  purpose: AccountPurpose;
  closingDay: number | null;
  paymentDay: number | null;
  note: string | null;
};

export class AccountStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountStoreError';
  }
}

type AccountRow = Database['public']['Tables']['accounts']['Row'];

function fromRow(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    institutionName: row.institution_name,
    kind: row.kind,
    purpose: row.purpose,
    closingDay: row.closing_day,
    paymentDay: row.payment_day,
    isActive: row.is_active,
    note: row.note,
  };
}

/** 有効な口座を、並び順→名前の順に返す。 */
export async function listAccounts(): Promise<Account[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new AccountStoreError(`口座の一覧を取得できませんでした: ${error.message}`);
  return data.map(fromRow);
}

export async function createAccount(input: AccountInput): Promise<Account> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new AccountStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      user_id: auth.user.id,
      name: input.name,
      institution_name: input.institutionName,
      kind: input.kind,
      purpose: input.purpose,
      closing_day: input.closingDay,
      payment_day: input.paymentDay,
      note: input.note,
    })
    .select('*')
    .single();

  if (error) throw new AccountStoreError(`口座を登録できませんでした: ${error.message}`);
  return fromRow(data);
}

export async function updateAccount(id: string, input: AccountInput): Promise<Account> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('accounts')
    .update({
      name: input.name,
      institution_name: input.institutionName,
      kind: input.kind,
      purpose: input.purpose,
      closing_day: input.closingDay,
      payment_day: input.paymentDay,
      note: input.note,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new AccountStoreError(`口座を更新できませんでした: ${error.message}`);
  return fromRow(data);
}

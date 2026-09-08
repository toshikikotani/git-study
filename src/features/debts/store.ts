/**
 * 負債(debts)のデータアクセス(M1-2)。
 *
 * この機能で最初に Supabase へ実際に読み書きする層。命名は
 * docs/glossary.md の「レイヤーの命名」に従う(list/get/create/update)。
 * RLS が本人の行だけに絞る(ADR-011)ので、SELECT 側で user_id を
 * 意識する必要はない。INSERT だけは呼び出し側の user_id を明示する
 * 必要がある(RLS の WITH CHECK は自動補完してくれない)。
 */

import { createClient } from '@/lib/supabase/server';
import type { DateOnly } from '@/lib/date';
import type { Database } from '@/lib/supabase/types';
import type { Debt as PayoffDebt } from '@/domain/payoff';

export type DebtKind = Database['public']['Enums']['debt_kind'];
export type DebtStatus = Database['public']['Enums']['debt_status'];

/** debts の1行(画面が必要とする部分)。docs/glossary.md の用語対応表を参照。 */
export type Debt = {
  id: string;
  lenderName: string;
  kind: DebtKind;
  status: DebtStatus;
  currentBalanceYen: number;
  originalPrincipalYen: number | null;
  minimumPaymentYen: number;
  annualRate: number;
  paymentDay: number;
  balanceAsOf: DateOnly;
  isEstimated: boolean;
  paidOffOn: DateOnly | null;
  note: string | null;
};

/** 新規作成・更新で本人が入力する項目。id・status 等はここでは扱わない。 */
export type DebtInput = {
  lenderName: string;
  kind: DebtKind;
  currentBalanceYen: number;
  /** 当初元本。任意入力(ホームの進捗ゲージの分母になる。無ければ現在残高で代用)。 */
  originalPrincipalYen: number | null;
  minimumPaymentYen: number;
  annualRate: number;
  paymentDay: number;
  note: string | null;
};

export class DebtStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebtStoreError';
  }
}

type DebtRow = Database['public']['Tables']['debts']['Row'];

function fromRow(row: DebtRow): Debt {
  return {
    id: row.id,
    lenderName: row.lender_name,
    kind: row.kind,
    status: row.status,
    currentBalanceYen: row.current_balance_yen,
    originalPrincipalYen: row.original_principal_yen,
    minimumPaymentYen: row.minimum_payment_yen,
    annualRate: row.annual_rate,
    paymentDay: row.payment_day,
    balanceAsOf: row.balance_as_of,
    isEstimated: row.is_estimated,
    paidOffOn: row.paid_off_on,
    note: row.note,
  };
}

/** 有効な負債を、残高の大きい順に返す。入力を促したい大口を上に出す。 */
export async function listDebts(): Promise<Debt[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('debts')
    .select('*')
    .eq('status', 'active')
    .order('sort_order', { ascending: true })
    .order('current_balance_yen', { ascending: false });

  if (error) throw new DebtStoreError(`負債の一覧を取得できませんでした: ${error.message}`);
  return data.map(fromRow);
}

/**
 * 新規登録する。本人が新しく入力した値なので is_estimated は false から始める
 * (ADR-006 の推定値はシードだけが持つ)。
 */
export async function createDebt(input: DebtInput): Promise<Debt> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new DebtStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('debts')
    .insert({
      user_id: auth.user.id,
      lender_name: input.lenderName,
      kind: input.kind,
      current_balance_yen: input.currentBalanceYen,
      original_principal_yen: input.originalPrincipalYen,
      minimum_payment_yen: input.minimumPaymentYen,
      annual_rate: input.annualRate,
      payment_day: input.paymentDay,
      note: input.note,
      is_estimated: false,
    })
    .select('*')
    .single();

  if (error) throw new DebtStoreError(`負債を登録できませんでした: ${error.message}`);
  return fromRow(data);
}

/**
 * 既存の値を編集する。ここを通った時点で本人が確認・修正した値になるので、
 * is_estimated を false に落とす(ADR-006:全件 false になるまでシステムは
 * 完済予定日を確定値として出さない)。
 */
export async function updateDebt(id: string, input: DebtInput): Promise<Debt> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('debts')
    .update({
      lender_name: input.lenderName,
      kind: input.kind,
      current_balance_yen: input.currentBalanceYen,
      original_principal_yen: input.originalPrincipalYen,
      minimum_payment_yen: input.minimumPaymentYen,
      annual_rate: input.annualRate,
      payment_day: input.paymentDay,
      note: input.note,
      is_estimated: false,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new DebtStoreError(`負債を更新できませんでした: ${error.message}`);
  return fromRow(data);
}

/** 完済シミュレーション(domain/payoff.ts)が必要とする形へ絞る。 */
export function toPayoffDebt(debt: Debt): PayoffDebt {
  return {
    id: debt.id,
    balanceYen: debt.currentBalanceYen,
    annualRate: debt.annualRate,
    minimumPaymentYen: debt.minimumPaymentYen,
    paymentDay: debt.paymentDay,
  };
}

/**
 * 返済実績(debt_payments)のデータアクセス(M1-6、FR-05)。
 *
 * 元本・利息の内訳は本人に入力させない。現在残高 × 年利 から利息分を
 * 自動算出し、残りを元本の減少に充てる。支払額が利息分にも満たない月は
 * 元本を据え置く(残高は減らないが、エラーにはしない。現実にそういう月もある)。
 *
 * 端数の扱い:支払額が「残高 + 未払利息」を上回る過払いのときは、超過分を
 * 利息側に寄せて principal_yen + interest_yen = amount_yen(DB制約)を保つ。
 * 極端な過払いは想定していないが、制約を破らないことを優先する。
 */

import { monthlyInterest } from '@/domain/money';
import type { DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export type DebtPayment = {
  id: string;
  paidOn: DateOnly;
  amountYen: number;
  principalYen: number | null;
  interestYen: number | null;
  balanceAfterYen: number | null;
  isExtra: boolean;
  note: string | null;
};

export type DebtPaymentInput = {
  paidOn: DateOnly;
  amountYen: number;
  note: string | null;
};

export class DebtPaymentStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebtPaymentStoreError';
  }
}

type DebtPaymentRow = Database['public']['Tables']['debt_payments']['Row'];

function fromRow(row: DebtPaymentRow): DebtPayment {
  return {
    id: row.id,
    paidOn: row.paid_on,
    amountYen: row.amount_yen,
    principalYen: row.principal_yen,
    interestYen: row.interest_yen,
    balanceAfterYen: row.balance_after_yen,
    isExtra: row.is_extra,
    note: row.note,
  };
}

/** 新しい順。直近の実績を上に出す。 */
export async function listDebtPayments(debtId: string): Promise<DebtPayment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('debt_payments')
    .select('*')
    .eq('debt_id', debtId)
    .order('paid_on', { ascending: false });

  if (error) {
    throw new DebtPaymentStoreError(`返済実績を取得できませんでした: ${error.message}`);
  }
  return data.map(fromRow);
}

/**
 * 返済を記録し、debts.current_balance_yen を更新する。
 * 残高が0円になれば status を 'paid_off' に遷移させる(ck_debts_paid_off_zero)。
 */
export async function recordDebtPayment(debtId: string, input: DebtPaymentInput): Promise<void> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new DebtPaymentStoreError('ログイン状態を確認できませんでした');
  }

  const { data: debtRow, error: debtError } = await supabase
    .from('debts')
    .select('current_balance_yen, annual_rate, minimum_payment_yen')
    .eq('id', debtId)
    .single();
  if (debtError) {
    throw new DebtPaymentStoreError(`負債を取得できませんでした: ${debtError.message}`);
  }

  const accruedInterestYen = monthlyInterest(debtRow.current_balance_yen, debtRow.annual_rate);
  const interestYen = Math.min(accruedInterestYen, input.amountYen);
  const principalYen = Math.min(input.amountYen - interestYen, debtRow.current_balance_yen);
  // 過払い分を利息側へ寄せることで、常に principal + interest = amount を保つ
  const interestYenFinal = input.amountYen - principalYen;
  const balanceAfterYen = debtRow.current_balance_yen - principalYen;

  const { error: insertError } = await supabase.from('debt_payments').insert({
    user_id: auth.user.id,
    debt_id: debtId,
    paid_on: input.paidOn,
    amount_yen: input.amountYen,
    principal_yen: principalYen,
    interest_yen: interestYenFinal,
    balance_after_yen: balanceAfterYen,
    is_extra: input.amountYen > debtRow.minimum_payment_yen,
    note: input.note,
  });
  if (insertError) {
    throw new DebtPaymentStoreError(`返済を記録できませんでした: ${insertError.message}`);
  }

  const { error: updateError } = await supabase
    .from('debts')
    .update(
      balanceAfterYen <= 0
        ? {
            current_balance_yen: 0,
            balance_as_of: input.paidOn,
            status: 'paid_off',
            paid_off_on: input.paidOn,
          }
        : { current_balance_yen: balanceAfterYen, balance_as_of: input.paidOn },
    )
    .eq('id', debtId);
  if (updateError) {
    throw new DebtPaymentStoreError(`負債の残高を更新できませんでした: ${updateError.message}`);
  }
}

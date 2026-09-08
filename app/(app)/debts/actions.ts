'use server';

/**
 * 負債フォームの Server Action(M1-2)。
 *
 * ここではバリデーションを呼び、店(store.ts)を叩くだけにする。
 * 条件式を増やしたくなったら domain/ 側に assertX/parseX を足す
 * (docs/glossary.md「レイヤーの命名」)。
 */

import { revalidatePath } from 'next/cache';

import { assertLenderName, assertPaymentDay, DebtError } from '@/domain/debt';
import { assertYen, MoneyError, parseAnnualRate, parseYen } from '@/domain/money';
import {
  createDebt,
  updateDebt,
  DebtStoreError,
  type DebtInput,
  type DebtKind,
} from '@/features/debts/store';

export type DebtFormState = {
  error: string | null;
};

const DEBT_KINDS: readonly DebtKind[] = [
  'revolving',
  'cashing',
  'installment',
  'card_loan',
  'consumer_finance',
  'bank_loan',
  'other',
];

function parseDebtInput(formData: FormData): DebtInput {
  const lenderName = assertLenderName(String(formData.get('lenderName') ?? ''));

  const kindRaw = String(formData.get('kind') ?? '');
  if (!DEBT_KINDS.includes(kindRaw as DebtKind)) {
    throw new DebtError(`種別が不正です: ${kindRaw}`);
  }

  const currentBalanceYen = assertYen(
    parseYen(String(formData.get('currentBalanceYen') ?? '')),
    '残高',
  );
  const minimumPaymentYen = assertYen(
    parseYen(String(formData.get('minimumPaymentYen') ?? '')),
    '最低返済額',
  );
  const annualRate = parseAnnualRate(String(formData.get('annualRate') ?? ''));
  const paymentDay = assertPaymentDay(Number(formData.get('paymentDay')));

  const noteRaw = String(formData.get('note') ?? '').trim();

  return {
    lenderName,
    kind: kindRaw as DebtKind,
    currentBalanceYen,
    minimumPaymentYen,
    annualRate,
    paymentDay,
    note: noteRaw === '' ? null : noteRaw,
  };
}

function describeError(error: unknown): string {
  if (
    error instanceof DebtError ||
    error instanceof MoneyError ||
    error instanceof DebtStoreError
  ) {
    return error.message;
  }
  return '保存に失敗しました。入力内容を確認してください。';
}

export async function createDebtAction(
  _prev: DebtFormState,
  formData: FormData,
): Promise<DebtFormState> {
  try {
    const input = parseDebtInput(formData);
    await createDebt(input);
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/debts');
  return { error: null };
}

export async function updateDebtAction(
  id: string,
  _prev: DebtFormState,
  formData: FormData,
): Promise<DebtFormState> {
  try {
    const input = parseDebtInput(formData);
    await updateDebt(id, input);
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/debts');
  return { error: null };
}

'use server';

/**
 * 口座フォームの Server Action(M6-1)。
 *
 * ここではバリデーションを呼び、店(store.ts)を叩くだけにする。
 * 条件式を増やしたくなったら domain/ 側に assertX/parseX を足す
 * (docs/glossary.md「レイヤーの命名」)。
 */

import { revalidatePath } from 'next/cache';

import {
  assertAccountName,
  assertClosingDay,
  assertPaymentDay,
  AccountError,
} from '@/domain/account';
import {
  createAccount,
  updateAccount,
  AccountStoreError,
  type AccountInput,
  type AccountKind,
  type AccountPurpose,
} from '@/features/accounts/store';

export type AccountFormState = {
  error: string | null;
};

const ACCOUNT_KINDS: readonly AccountKind[] = [
  'bank',
  'credit_card',
  'cash',
  'securities',
  'e_money',
  'other',
];

const ACCOUNT_PURPOSES: readonly AccountPurpose[] = [
  'salary',
  'repayment',
  'investment',
  'sanctuary',
  'living',
  'emergency',
  'other',
];

function parseDayField(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? '').trim();
  return raw === '' ? null : Number(raw);
}

function parseAccountInput(formData: FormData): AccountInput {
  const name = assertAccountName(String(formData.get('name') ?? ''));

  const kindRaw = String(formData.get('kind') ?? '');
  if (!ACCOUNT_KINDS.includes(kindRaw as AccountKind)) {
    throw new AccountError(`種別が不正です: ${kindRaw}`);
  }

  const purposeRaw = String(formData.get('purpose') ?? '');
  if (!ACCOUNT_PURPOSES.includes(purposeRaw as AccountPurpose)) {
    throw new AccountError(`用途が不正です: ${purposeRaw}`);
  }

  const closingDay = assertClosingDay(parseDayField(formData, 'closingDay'));
  const paymentDay = assertPaymentDay(parseDayField(formData, 'paymentDay'));

  const institutionNameRaw = String(formData.get('institutionName') ?? '').trim();
  const noteRaw = String(formData.get('note') ?? '').trim();

  return {
    name,
    institutionName: institutionNameRaw === '' ? null : institutionNameRaw,
    kind: kindRaw as AccountKind,
    purpose: purposeRaw as AccountPurpose,
    closingDay,
    paymentDay,
    note: noteRaw === '' ? null : noteRaw,
  };
}

function describeError(error: unknown): string {
  if (error instanceof AccountError || error instanceof AccountStoreError) {
    return error.message;
  }
  return '保存に失敗しました。入力内容を確認してください。';
}

export async function createAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  try {
    const input = parseAccountInput(formData);
    await createAccount(input);
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/accounts');
  return { error: null };
}

export async function updateAccountAction(
  id: string,
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  try {
    const input = parseAccountInput(formData);
    await updateAccount(id, input);
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/accounts');
  return { error: null };
}

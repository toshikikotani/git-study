'use server';

/**
 * 振替ルールフォームの Server Action(M4-3)。
 */

import { revalidatePath } from 'next/cache';

import { assertAmountShape, assertRuleName, TransferRuleError } from '@/domain/transfer-rule';
import { MoneyError } from '@/domain/money';
import {
  createTransferRule,
  deleteTransferRule,
  moveTransferRuleDown,
  moveTransferRuleUp,
  updateTransferRule,
  TransferRuleStoreError,
  type AmountType,
  type TransferRuleInput,
} from '@/features/transfer-rules/store';

export type TransferRuleFormState = {
  error: string | null;
};

const AMOUNT_TYPES: readonly AmountType[] = ['fixed', 'percentage', 'remainder'];

function parseTransferRuleInput(formData: FormData): TransferRuleInput {
  const name = assertRuleName(String(formData.get('name') ?? ''));

  const amountTypeRaw = String(formData.get('amountType') ?? '');
  if (!AMOUNT_TYPES.includes(amountTypeRaw as AmountType)) {
    throw new TransferRuleError(`金額の指定方式が不正です: ${amountTypeRaw}`);
  }
  const amountType = amountTypeRaw as AmountType;

  const { amountYen, percentage } = assertAmountShape(
    amountType,
    String(formData.get('amountYen') ?? ''),
    String(formData.get('percentage') ?? ''),
  );

  const toAccountIdRaw = String(formData.get('toAccountId') ?? '');
  const categoryIdRaw = String(formData.get('categoryId') ?? '');
  const noteRaw = String(formData.get('note') ?? '').trim();

  return {
    name,
    amountType,
    amountYen,
    percentage,
    toAccountId: toAccountIdRaw === '' ? null : toAccountIdRaw,
    categoryId: categoryIdRaw === '' ? null : categoryIdRaw,
    note: noteRaw === '' ? null : noteRaw,
  };
}

function describeError(error: unknown): string {
  if (
    error instanceof TransferRuleError ||
    error instanceof MoneyError ||
    error instanceof TransferRuleStoreError
  ) {
    return error.message;
  }
  return '保存に失敗しました。入力内容を確認してください。';
}

export async function createTransferRuleAction(
  _prev: TransferRuleFormState,
  formData: FormData,
): Promise<TransferRuleFormState> {
  try {
    const input = parseTransferRuleInput(formData);
    await createTransferRule(input);
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/payday');
  return { error: null };
}

export async function updateTransferRuleAction(
  id: string,
  _prev: TransferRuleFormState,
  formData: FormData,
): Promise<TransferRuleFormState> {
  try {
    const input = parseTransferRuleInput(formData);
    await updateTransferRule(id, input);
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/payday');
  return { error: null };
}

export async function deleteTransferRuleAction(id: string): Promise<void> {
  await deleteTransferRule(id);
  revalidatePath('/payday');
}

export async function moveTransferRuleUpAction(id: string): Promise<void> {
  await moveTransferRuleUp(id);
  revalidatePath('/payday');
}

export async function moveTransferRuleDownAction(id: string): Promise<void> {
  await moveTransferRuleDown(id);
  revalidatePath('/payday');
}

'use server';

/**
 * 投資の拠出・残高記録の Server Action(M7-2)。
 *
 * ここではバリデーションを呼び、店(store.ts)を叩くだけにする
 * (docs/glossary.md「レイヤーの命名」、M1-6 の payment-actions.ts と同じ構造)。
 */

import { revalidatePath } from 'next/cache';

import {
  assertContributionAmountYen,
  assertProductName,
  assertSnapshotCostBasisYen,
  assertSnapshotValueYen,
  InvestmentError,
} from '@/domain/investment';
import { MoneyError, parseYen } from '@/domain/money';
import {
  createInvestmentContribution,
  upsertInvestmentSnapshot,
  InvestmentStoreError,
  type InvestmentContributionInput,
  type InvestmentSnapshotInput,
} from '@/features/investments/store';
import { assertDateOnly } from '@/lib/date';

export type InvestmentFormState = {
  error: string | null;
};

function describeError(error: unknown): string {
  if (
    error instanceof InvestmentError ||
    error instanceof InvestmentStoreError ||
    error instanceof MoneyError
  ) {
    return error.message;
  }
  return '保存に失敗しました。入力内容を確認してください。';
}

function parseContributionInput(formData: FormData): InvestmentContributionInput {
  const contributedOn = assertDateOnly(String(formData.get('contributedOn') ?? ''));
  const amountYen = assertContributionAmountYen(parseYen(String(formData.get('amountYen') ?? '')));
  const productNameRaw = String(formData.get('productName') ?? '').trim();
  const noteRaw = String(formData.get('note') ?? '').trim();

  return {
    contributedOn,
    amountYen,
    productName: productNameRaw === '' ? null : productNameRaw,
    isHighRisk: formData.get('isHighRisk') === 'on',
    note: noteRaw === '' ? null : noteRaw,
  };
}

export async function createContributionAction(
  _prev: InvestmentFormState,
  formData: FormData,
): Promise<InvestmentFormState> {
  try {
    const input = parseContributionInput(formData);
    await createInvestmentContribution(input);
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/investments');
  return { error: null };
}

function parseSnapshotInput(formData: FormData): InvestmentSnapshotInput {
  const asOf = assertDateOnly(String(formData.get('asOf') ?? ''));
  const productName = assertProductName(String(formData.get('productName') ?? ''));
  const marketValueYen = assertSnapshotValueYen(
    parseYen(String(formData.get('marketValueYen') ?? '')),
  );
  const costBasisRaw = String(formData.get('costBasisYen') ?? '').trim();
  const costBasisYen = assertSnapshotCostBasisYen(
    costBasisRaw === '' ? null : parseYen(costBasisRaw),
  );

  return { asOf, productName, marketValueYen, costBasisYen };
}

export async function upsertSnapshotAction(
  _prev: InvestmentFormState,
  formData: FormData,
): Promise<InvestmentFormState> {
  try {
    const input = parseSnapshotInput(formData);
    await upsertInvestmentSnapshot(input);
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/investments');
  return { error: null };
}

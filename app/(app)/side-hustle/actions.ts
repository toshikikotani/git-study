'use server';

/**
 * `/side-hustle` の Server Action(P3-1)。
 */

import { revalidatePath } from 'next/cache';

import {
  assertIncomeAmountYen,
  assertProjectName,
  assertWorkMinutes,
  SideHustleError,
} from '@/domain/side-hustle';
import { parseYen } from '@/domain/money';
import { createIncome, createProject, createWorkLog } from '@/features/side-hustle/store';
import { assertDateOnly } from '@/lib/date';
import { describeUserError } from '@/lib/errors';

export type SideHustleFormState = {
  error: string | null;
};

export async function createProjectAction(
  _prev: SideHustleFormState,
  formData: FormData,
): Promise<SideHustleFormState> {
  try {
    const name = assertProjectName(String(formData.get('name') ?? ''));
    const clientNameRaw = String(formData.get('clientName') ?? '').trim();
    const kindRaw = String(formData.get('kind') ?? '').trim();

    await createProject({
      name,
      clientName: clientNameRaw === '' ? null : clientNameRaw,
      kind: kindRaw === '' ? null : kindRaw,
      note: null,
    });
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/side-hustle');
  return { error: null };
}

export async function createWorkLogAction(
  _prev: SideHustleFormState,
  formData: FormData,
): Promise<SideHustleFormState> {
  try {
    const projectId = String(formData.get('projectId') ?? '');
    if (projectId === '') throw new SideHustleError('プロジェクトを選んでください');
    const workedOn = assertDateOnly(String(formData.get('workedOn') ?? ''));
    const minutes = assertWorkMinutes(Number(formData.get('minutes')));
    const summaryRaw = String(formData.get('summary') ?? '').trim();

    await createWorkLog({
      projectId,
      workedOn,
      minutes,
      summary: summaryRaw === '' ? null : summaryRaw,
    });
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/side-hustle');
  return { error: null };
}

export async function createIncomeAction(
  _prev: SideHustleFormState,
  formData: FormData,
): Promise<SideHustleFormState> {
  try {
    const projectIdRaw = String(formData.get('projectId') ?? '');
    const receivedOn = assertDateOnly(String(formData.get('receivedOn') ?? ''));
    const amountYen = assertIncomeAmountYen(parseYen(String(formData.get('amountYen') ?? '')));
    const noteRaw = String(formData.get('note') ?? '').trim();

    await createIncome({
      projectId: projectIdRaw === '' ? null : projectIdRaw,
      receivedOn,
      amountYen,
      note: noteRaw === '' ? null : noteRaw,
    });
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/side-hustle');
  return { error: null };
}

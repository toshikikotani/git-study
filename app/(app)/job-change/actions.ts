'use server';

/**
 * `/job-change` の Server Action(P3-2)。
 */

import { revalidatePath } from 'next/cache';

import { assertMilestoneTitle, JobChangeError } from '@/domain/job-change';
import {
  createMilestone,
  deleteMilestone,
  JobChangeStoreError,
  setMilestoneStatus,
  type MilestonePhase,
  type MilestoneStatus,
} from '@/features/job-change/store';

export type MilestoneFormState = {
  error: string | null;
};

const PHASES: readonly MilestonePhase[] = ['research', 'resume', 'apply', 'interview', 'offer'];
const STATUSES: readonly MilestoneStatus[] = ['todo', 'doing', 'done', 'dropped'];

function describeError(error: unknown): string {
  if (error instanceof JobChangeError || error instanceof JobChangeStoreError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function createMilestoneAction(
  _prev: MilestoneFormState,
  formData: FormData,
): Promise<MilestoneFormState> {
  const phaseRaw = String(formData.get('phase') ?? '');
  const phase = PHASES.find((p) => p === phaseRaw);
  if (!phase) return { error: '区分を選んでください' };

  const dueOnRaw = String(formData.get('dueOn') ?? '').trim();
  const noteRaw = String(formData.get('note') ?? '').trim();

  try {
    const title = assertMilestoneTitle(String(formData.get('title') ?? ''));
    await createMilestone({
      phase,
      title,
      dueOn: dueOnRaw === '' ? null : dueOnRaw,
      note: noteRaw === '' ? null : noteRaw,
    });
  } catch (error) {
    return { error: describeError(error) };
  }

  revalidatePath('/job-change');
  return { error: null };
}

export async function setMilestoneStatusAction(
  id: string,
  status: string,
): Promise<{ error: string | null }> {
  const matched = STATUSES.find((s) => s === status);
  if (!matched) return { error: '状態の指定が正しくありません' };
  try {
    await setMilestoneStatus(id, matched);
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/job-change');
  return { error: null };
}

export async function deleteMilestoneAction(id: string): Promise<{ error: string | null }> {
  try {
    await deleteMilestone(id);
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/job-change');
  return { error: null };
}

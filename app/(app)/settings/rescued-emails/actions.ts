'use server';

import { revalidatePath } from 'next/cache';

import { deleteRescuedEmail } from '@/features/import/rescue-store';

export async function deleteRescuedEmailAction(id: string): Promise<{ error: string | null }> {
  try {
    await deleteRescuedEmail(id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath('/settings/rescued-emails');
  return { error: null };
}

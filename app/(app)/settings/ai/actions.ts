'use server';

/**
 * `/settings/ai` の Server Action(N1)。全AI機能の一括オン/オフだけを扱う。
 */

import { revalidatePath } from 'next/cache';

import { SettingsStoreError, updateAppSettings } from '@/features/settings/store';

export type AiSettingsFormState = {
  error: string | null;
  saved: boolean;
};

export async function updateAiSettingsAction(
  _prev: AiSettingsFormState,
  formData: FormData,
): Promise<AiSettingsFormState> {
  const aiEnabled = formData.get('aiEnabled') === 'on';

  try {
    await updateAppSettings({ aiEnabled });
  } catch (error) {
    if (error instanceof SettingsStoreError) {
      return { error: error.message, saved: false };
    }
    throw error;
  }

  revalidatePath('/settings/ai');
  return { error: null, saved: true };
}

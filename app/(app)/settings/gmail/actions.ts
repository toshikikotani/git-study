'use server';

/**
 * `/settings/gmail` の Server Action(T-22)。
 *
 * 資格情報や取り込み先口座はここでは扱わない(環境変数のみ、ADR-018)。
 * 保存するのは有効フラグ・差出人の絞り込み・1回の取得件数上限の3つだけ。
 */

import { revalidatePath } from 'next/cache';

import {
  assertGmailFetchLimit,
  assertGmailFromAddresses,
  GmailSettingsError,
} from '@/domain/gmail-settings';
import { GmailSettingsStoreError, updateGmailSettings } from '@/features/settings/gmail-store';

export type GmailSettingsFormState = {
  error: string | null;
  saved: boolean;
};

export async function updateGmailSettingsAction(
  _prev: GmailSettingsFormState,
  formData: FormData,
): Promise<GmailSettingsFormState> {
  const gmailEnabled = formData.get('gmailEnabled') === 'on';
  const fromAddressesRaw = String(formData.get('gmailFromAddresses') ?? '');
  const fetchLimitRaw = Number(formData.get('gmailFetchLimit'));

  try {
    const gmailFromAddresses = assertGmailFromAddresses(
      fromAddressesRaw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    );
    const gmailFetchLimit = assertGmailFetchLimit(fetchLimitRaw);

    await updateGmailSettings({ gmailEnabled, gmailFromAddresses, gmailFetchLimit });
  } catch (error) {
    if (error instanceof GmailSettingsError || error instanceof GmailSettingsStoreError) {
      return { error: error.message, saved: false };
    }
    throw error;
  }

  revalidatePath('/settings/gmail');
  return { error: null, saved: true };
}

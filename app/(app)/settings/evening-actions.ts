'use server';

/**
 * 設定の画面の「LINE の夜の答え合わせ」(ADR-130)。送るか・何時に送るかだけを扱う。
 */

import { revalidatePath } from 'next/cache';

import { SettingsStoreError, updateAppSettings } from '@/features/settings/store';

const TIMES = new Set(['18:00', '19:00', '20:00', '21:00', '22:00', '23:00']);

export async function updateEveningCheckAction(input: {
  enabled: boolean;
  at: string;
}): Promise<{ error: string | null }> {
  if (!TIMES.has(input.at)) return { error: '時刻を選び直してください。' };
  try {
    await updateAppSettings({ eveningCheckEnabled: input.enabled, eveningCheckAt: input.at });
  } catch (error) {
    if (error instanceof SettingsStoreError) {
      return {
        error: error.message.includes('evening_check')
          ? 'データベースの更新(supabase/apply-pending.sql)がまだです。適用すると保存できます。'
          : error.message,
      };
    }
    throw error;
  }
  revalidatePath('/settings');
  return { error: null };
}

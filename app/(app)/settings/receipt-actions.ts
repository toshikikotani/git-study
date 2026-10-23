'use server';

/**
 * 設定の画面の「レシートの確かめる細かさ」(ADR-133)。しっかり・ふつう・少なめだけを扱う。
 */

import { revalidatePath } from 'next/cache';

import { CHECK_LEVELS, type CheckLevel } from '@/domain/receipt-questions';
import { SettingsStoreError, updateAppSettings } from '@/features/settings/store';

export async function updateReceiptCheckLevelAction(
  level: CheckLevel,
): Promise<{ error: string | null }> {
  if (!CHECK_LEVELS.includes(level)) return { error: '選び直してください。' };
  try {
    await updateAppSettings({ receiptCheckLevel: level });
  } catch (error) {
    if (error instanceof SettingsStoreError) {
      return {
        error: error.message.includes('receipt_check_level')
          ? 'データベースの更新(supabase/apply-pending.sql)がまだです。適用すると保存できます。'
          : error.message,
      };
    }
    throw error;
  }
  revalidatePath('/settings');
  revalidatePath('/spending/review');
  return { error: null };
}

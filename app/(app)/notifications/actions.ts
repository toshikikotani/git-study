'use server';

import { revalidatePath } from 'next/cache';

import { acknowledgeAll } from '@/features/alerts/inbox';

/** お知らせをすべて既読にする(ホームのお知らせボタンの印も消える)。 */
export async function acknowledgeAllAction(): Promise<{ error: string | null }> {
  try {
    await acknowledgeAll();
  } catch (error) {
    return { error: error instanceof Error ? error.message : '既読にできませんでした' };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

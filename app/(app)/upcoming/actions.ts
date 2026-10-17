'use server';

import { revalidatePath } from 'next/cache';

import { setGenreForecastClosed } from '@/features/genre/store';
import { confirmFixedCost, unconfirmFixedCost } from '@/features/subscriptions/fixed-cost-store';
import { describeUserError } from '@/lib/errors';

/**
 * カテゴリごとの固定費を外す(これからの支払い、ADR-108)。カテゴリの予測を止める印と、カテゴリの固定費の
 * 確認(genre:<id>)の両方を外す。固定費は記録ごとに決める(ADR-102)。
 */
export async function releaseCategoryFixedAction(
  genreId: string,
): Promise<{ error: string | null }> {
  try {
    await setGenreForecastClosed(genreId, false);
    await unconfirmFixedCost(`genre:${genreId}`);
  } catch (error) {
    return { error: describeUserError(error, '固定費から外せませんでした。') };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

/** 外したのを元に戻す(カテゴリの予測を止める印を戻す)。 */
export async function restoreCategoryFixedAction(
  genreId: string,
): Promise<{ error: string | null }> {
  try {
    await setGenreForecastClosed(genreId, true);
  } catch (error) {
    return { error: describeUserError(error, '元に戻せませんでした。') };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

/** 見つけた定期支払いを固定費にする(その店・その額だけ。カテゴリ全体は固定費にしない、ADR-102)。 */
export async function confirmDetectedFixedAction(
  subscriptionKey: string,
): Promise<{ error: string | null }> {
  try {
    await confirmFixedCost(subscriptionKey);
  } catch (error) {
    return { error: describeUserError(error, '固定費にできませんでした。') };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

'use server';

import { revalidatePath } from 'next/cache';

import { addPlanGenre } from '@/features/spending-plan/membership';
import { describeUserError } from '@/lib/errors';

function refresh() {
  revalidatePath('/plan');
  revalidatePath('/spending');
}

export async function addGoalGenreAction(
  planId: string,
  genreId: string,
  targetYen: number,
): Promise<{ error: string | null }> {
  try {
    await addPlanGenre(planId, genreId, targetYen);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  refresh();
  return { error: null };
}

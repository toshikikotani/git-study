'use server';

import { revalidatePath } from 'next/cache';

import { loadCategoryOutlooks } from '@/features/goals/category-outlook';
import { markTargetsChosen } from '@/features/spending-plan/membership';
import { getCurrentPlan, updatePlanTargets } from '@/features/spending-plan/store';
import { todayJst } from '@/lib/date';
import { describeUserError } from '@/lib/errors';

/** 目標額の刻み(見込みを切り上げる)。 */
const ROUND = 100;

/**
 * 目標なしのカテゴリに、見込みに合わせて目標をつける(分析 › 目標の「目標なし」、デザイン v3-6、ADR-108)。
 * 目標額は見込み(中央)と、使った額+予定の大きいほうを100円単位で切り上げた額。
 */
export async function setTargetsFromOutlookAction(): Promise<{ error: string | null }> {
  try {
    const today = todayJst();
    const plan = await getCurrentPlan(today);
    if (plan === null) return { error: '今期の目標がありません。' };
    const loaded = await loadCategoryOutlooks({ plan, today });
    const items = loaded.outlooks
      .filter((o) => o.untargeted)
      .map((o) => ({
        genreId: o.genreId,
        targetYen: Math.ceil(Math.max(o.p50 ?? 0, o.spentYen + o.scheduledYen) / ROUND) * ROUND,
      }));
    if (items.length === 0) return { error: null };
    await updatePlanTargets(plan.id, items);
    await markTargetsChosen(
      plan.id,
      items.map((i) => i.genreId),
    );
  } catch (error) {
    return { error: describeUserError(error, '目標をつけられませんでした。') };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

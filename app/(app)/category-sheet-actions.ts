'use server';

import { revalidatePath } from 'next/cache';

import { loadCategoryOutlooks, type CategoryOutlook } from '@/features/goals/category-outlook';
import { addPlanGenre } from '@/features/spending-plan/membership';
import { getCurrentPlan, updatePlanTargets } from '@/features/spending-plan/store';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { todayJst } from '@/lib/date';
import { describeUserError } from '@/lib/errors';

/** カテゴリのシート(⑦)に出すもの。 */
export type CategorySheetData = {
  outlook: CategoryOutlook;
  /** 今の目標。無ければ null(目標額は決められない)。 */
  planId: string | null;
  periodStart: string;
  periodEnd: string;
  today: string;
  remainingDays: number;
  isFixed: boolean;
  showOnHome: boolean;
};

/** カテゴリのシートを開くときに読む(どの画面のマークから開いても同じ)。 */
export async function loadCategorySheetAction(
  genreId: string,
): Promise<{ data: CategorySheetData | null; error: string | null }> {
  try {
    const today = todayJst();
    const plan = await getCurrentPlan(today).catch(() => null);
    const [loaded, fixedKeys] = await Promise.all([
      loadCategoryOutlooks({ plan, today, genreIds: [genreId] }),
      listConfirmedFixedCostKeys().catch(() => new Set<string>()),
    ]);
    const outlook = loaded.outlooks[0];
    const genre = loaded.genres.find((g) => g.id === genreId);
    if (outlook === undefined || genre === undefined) {
      return { data: null, error: 'カテゴリが見つかりませんでした' };
    }
    return {
      data: {
        outlook,
        planId: plan?.id ?? null,
        periodStart: loaded.period.from,
        periodEnd: loaded.period.to,
        today,
        remainingDays: loaded.remainingDays,
        isFixed: fixedKeys.has(`genre:${genreId}`),
        showOnHome: genre.showOnHome,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: describeUserError(error) };
  }
}

/**
 * カテゴリの今期の目標額を保存する(⑦の「完了」)。目標に入っていなければ足す。
 * 使った額より下にはできない(デザイン仕様書のルール)。
 */
export async function saveCategoryTargetAction(input: {
  planId: string;
  genreId: string;
  targetYen: number;
  inPlan: boolean;
  floorYen: number;
}): Promise<{ error: string | null }> {
  const { planId, genreId, targetYen, inPlan, floorYen } = input;
  if (!Number.isInteger(targetYen) || targetYen < 0) {
    return { error: '目標額は0円以上の整数で入力してください' };
  }
  if (targetYen < floorYen) return { error: '使った額より下にはできません' };
  try {
    if (inPlan) await updatePlanTargets(planId, [{ genreId, targetYen }]);
    else await addPlanGenre(planId, genreId, targetYen);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}

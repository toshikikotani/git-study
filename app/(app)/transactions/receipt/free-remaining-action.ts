'use server';

import { todayJst } from '@/lib/date';
import { loadMonthlyLedger } from '@/features/spending/store';
import { getCurrentPlan } from '@/features/spending-plan/store';

/** 今の自由残。目標の合計から、実績と予定を引いた額。目標が無ければ null。 */
export async function freeRemainingAction(): Promise<number | null> {
  const today = todayJst();
  const [ledger, plan] = await Promise.all([
    loadMonthlyLedger().catch(() => null),
    getCurrentPlan(today).catch(() => null),
  ]);
  if (!ledger || !plan) return null;
  const cap = plan.items.reduce((sum, item) => sum + item.targetYen, 0);
  if (cap <= 0) return null;
  return cap - ledger.totals.paceSpentYen - ledger.totals.scheduledYen;
}

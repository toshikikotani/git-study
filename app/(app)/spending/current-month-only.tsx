'use client';

import type { ReactNode } from 'react';

import { useSpendingMonth } from './spending-month-provider';

/** 今月にしか意味が無いカード(気づき・予測など)を、別の月では隠す。 */
export function CurrentMonthOnly({ children }: { children: ReactNode }) {
  const { isCurrentMonth } = useSpendingMonth();
  return isCurrentMonth ? <>{children}</> : null;
}

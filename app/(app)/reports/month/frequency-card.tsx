'use client';

import { useSpendingMonth } from '../../spending/spending-month-provider';
import { BubbleChart } from '../bubble-chart';
import { frequencyPoints } from '../frequency';

/**
 * 回数と1回の金額(月のふりかえりのカード、ADR-127。もとは別の画面)。月の切り替えで選んだ月の明細から、
 * カテゴリごとの回数・1回の平均・合計を出す。
 */
export function FrequencyCard() {
  const { transactions, loading } = useSpendingMonth();
  if (loading) return null;
  const points = frequencyPoints(transactions);
  if (points.length === 0) return null;
  return <BubbleChart points={points} />;
}

/**
 * 支出の型を、記録から自動で決める(設計書 v3 4.1)。
 *
 * - 決まった型:予測を止めたジャンル、月払いの請求・固定費だけのジャンル
 * - 定常型:規則的に通う店がある、または月に4回以上で、間の日数がばらつきすぎない
 * - まとまり型:月に2回未満、または間の日数が大きくばらつく(まとめて払う)。記録が短くて
 *   回数で決めきれないときは、名前(旅行・家電・冠婚葬祭・医療)で決める
 */

import { daysBetween, type DateOnly } from '@/lib/date';
import type { SpendingType } from './types';

const STEADY_PER_MONTH = 4;
const LUMPY_PER_MONTH = 2;
/** 間の日数の変動係数がこれより大きければ、まとめて払っている(まとまり型)。 */
const MAX_STEADY_GAP_CV = 1.2;
/** これより短い記録では、回数だけでまとまり型にしない(使い始めたばかりの人のカフェ等)。 */
const MIN_DAYS_FOR_RATE = 28;
const LUMPY_NAME = /旅行|トラベル|家電|冠婚葬祭|医療|病院|引っ越し|引越/;

export function classifySpending(input: {
  name: string;
  /** 支出のあった日(変動費として学ぶ明細。重複はまとめる)。 */
  eventDates: readonly DateOnly[];
  /** 記録の日数(学習に使える期間)。 */
  recordDays: number;
  hasRegularMerchant: boolean;
  hasBills: boolean;
  closed: boolean;
}): SpendingType {
  if (input.closed) return 'fixed';
  if (input.hasRegularMerchant) return 'steady';
  const dates = [...new Set(input.eventDates)].sort();
  if (dates.length === 0) return input.hasBills ? 'fixed' : 'steady';
  const nameLumpy = LUMPY_NAME.test(input.name);
  const perMonth = (dates.length / Math.max(1, input.recordDays)) * 30;
  if (input.recordDays < MIN_DAYS_FOR_RATE) {
    return nameLumpy && perMonth < STEADY_PER_MONTH ? 'lumpy' : 'steady';
  }
  if (perMonth < LUMPY_PER_MONTH) return 'lumpy';
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
  const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / Math.max(1, gaps.length));
  const cv = mean > 0 ? sd / mean : 0;
  if (perMonth >= STEADY_PER_MONTH && cv <= MAX_STEADY_GAP_CV * 1.25) return 'steady';
  if (cv > MAX_STEADY_GAP_CV || (nameLumpy && perMonth < STEADY_PER_MONTH)) return 'lumpy';
  return 'steady';
}

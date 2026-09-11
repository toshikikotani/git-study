import type { CategoryKind } from '@/features/categories/store';

/** seed_defaults()(docs/schema.sql §8)の表示名と揃える。 */
export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  fixed_cost: '固定費',
  living: '生活費',
  sanctuary: '聖域',
  waste: '浪費',
  investment_spending: '投資的支出',
  repayment: '返済',
  investment: '投資',
  income: '収入',
  transfer: '口座間振替',
  other: 'その他',
};

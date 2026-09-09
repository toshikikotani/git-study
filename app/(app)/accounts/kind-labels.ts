import type { AccountKind, AccountPurpose } from '@/features/accounts/store';

/**
 * 種別・用途の表示名。カテゴリ(categories.name)と違い、本人が改名できる対象では
 * ないので、データではなくここに固定で持つ(ADR-016 はカテゴリだけが対象)。
 * フォームの選択肢と一覧の表示、両方から参照する。
 */
export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  bank: '銀行口座',
  credit_card: 'クレジットカード',
  cash: '現金',
  securities: '証券口座',
  e_money: '電子マネー・コード決済',
  other: 'その他',
};

export const ACCOUNT_PURPOSE_LABELS: Record<AccountPurpose, string> = {
  salary: '給与受取',
  repayment: '返済',
  investment: '投資',
  sanctuary: '聖域支出',
  living: '生活費',
  emergency: '生活防衛資金',
  other: 'その他',
};

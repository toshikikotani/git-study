import type { DebtKind } from '@/features/debts/store';

/**
 * 種別の表示名。カテゴリ(categories.name)と違い、本人が改名できる対象では
 * ないので、データではなくここに固定で持つ(ADR-016 はカテゴリだけが対象)。
 * フォームの選択肢と一覧の表示、両方から参照する。
 */
export const DEBT_KIND_LABELS: Record<DebtKind, string> = {
  revolving: 'リボ払い',
  cashing: 'キャッシング',
  installment: '分割払い',
  card_loan: 'カードローン',
  consumer_finance: '消費者金融',
  bank_loan: '銀行ローン',
  other: 'その他',
};

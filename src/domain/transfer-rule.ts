/**
 * 振替ルールフォームの入力値検証(M4-3、FR-15)。
 *
 * amount_type ごとに必要な列が変わる(DB の
 * ck_transfer_rules_amount_shape と対応)。ここでその形を作る。
 */

import { assertYen, parseYen } from './money';

export class TransferRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferRuleError';
  }
}

export type AmountType = 'fixed' | 'percentage' | 'remainder';

export type AmountShape = {
  amountYen: number | null;
  percentage: number | null;
};

/** ルール名。空文字・空白のみは拒否する。 */
export function assertRuleName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new TransferRuleError('ルール名を入力してください');
  }
  return trimmed;
}

/**
 * amount_type に応じて、それ以外の列を必ず null にする。
 * fixed は正の円、percentage は0より大きく100以下、remainder はどちらも持たない。
 */
export function assertAmountShape(
  amountType: AmountType,
  rawAmountYen: string,
  rawPercentage: string,
): AmountShape {
  if (amountType === 'fixed') {
    const amountYen = assertYen(parseYen(rawAmountYen), '金額');
    if (amountYen <= 0) {
      throw new TransferRuleError(`金額は正の値で指定してください: ${amountYen}`);
    }
    return { amountYen, percentage: null };
  }

  if (amountType === 'percentage') {
    const percentage = Number(rawPercentage);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      throw new TransferRuleError(`割合は0より大きく100以下で指定してください: ${rawPercentage}`);
    }
    return { amountYen: null, percentage };
  }

  return { amountYen: null, percentage: null };
}

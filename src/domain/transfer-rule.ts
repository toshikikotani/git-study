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

/** チェックリストの1項目。ルールから生成した振替の予定額(M4-4)。 */
export type TransferPlanItem = {
  ruleId: string;
  label: string;
  plannedAmountYen: number;
};

/** 予定額を計算する対象。ルールの必要な部分だけ。 */
export type PlannableRule = {
  id: string;
  name: string;
  amountType: AmountType;
  amountYen: number | null;
  percentage: number | null;
};

/**
 * 給料日の振替ルールを、実際の入金額に対して按分する(FR-15, M4-4)。
 *
 * execution_order 順に処理し、fixed/percentage が確保した後の残りを
 * remainder ルールが受け取る。fixed/percentage の合計が入金額を超える
 * (残額が足りない)場合は、以降の予定額を0円に切り詰める。マイナスの
 * 振替は意味を持たないし、transfer_run_items.planned_amount_yen は
 * DB 制約で0以上しか許さない。
 */
export function computeTransferPlan(
  rules: readonly PlannableRule[],
  sourceAmountYen: number,
): TransferPlanItem[] {
  if (!Number.isFinite(sourceAmountYen) || sourceAmountYen <= 0) {
    throw new TransferRuleError(`入金額は正の値で指定してください: ${sourceAmountYen}`);
  }

  let remaining = sourceAmountYen;

  return rules.map((rule) => {
    let planned: number;
    if (rule.amountType === 'fixed') {
      planned = rule.amountYen ?? 0;
    } else if (rule.amountType === 'percentage') {
      planned = Math.round((sourceAmountYen * (rule.percentage ?? 0)) / 100);
    } else {
      planned = remaining;
    }

    planned = Math.max(0, Math.min(planned, remaining));
    remaining -= planned;

    return { ruleId: rule.id, label: rule.name, plannedAmountYen: planned };
  });
}

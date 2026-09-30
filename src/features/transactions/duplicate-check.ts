/**
 * スクショから記録(N3)の重複警告。取り込み時の fingerprint(完全一致)とは
 * 別に、ここでは「同じ額・近い日付の明細が既にある」というゆるい一致を見る
 * ——スクリーンショットから書き起こした店名・摘要は、既存の記録(レシート・
 * CSV・メール取り込み)の表記とそのまま一致することはまず無いため、
 * fingerprintOf() の完全一致では重複を検出できない。
 */

import { addDays, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

export type PossibleDuplicate = {
  id: string;
  description: string;
  occurredOn: DateOnly;
  amountYen: number;
};

/** 日付の前後にこの日数までを「近い日付」とみなす。 */
const DATE_TOLERANCE_DAYS = 2;

/** 金額が一致し、日付が前後2日以内の既存の支出を探す(見つかれば重複の疑い)。 */
export async function findPossibleDuplicate(
  occurredOn: DateOnly,
  amountYen: number,
): Promise<PossibleDuplicate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transactions')
    .select('id, description, merchant_name, occurred_on, amount_yen')
    .eq('amount_yen', -Math.abs(amountYen))
    .gte('occurred_on', addDays(occurredOn, -DATE_TOLERANCE_DAYS))
    .lte('occurred_on', addDays(occurredOn, DATE_TOLERANCE_DAYS))
    .limit(1)
    .maybeSingle();
  if (error || data === null) return null;

  return {
    id: data.id,
    description: data.merchant_name ?? data.description,
    occurredOn: data.occurred_on,
    amountYen: Math.abs(data.amount_yen),
  };
}

/**
 * 定期支払い(サブスク)の検知(本人発案)。
 *
 * 「同じ店・同じ金額の支出が、ほぼ1ヶ月おきに続けて出てくる」明細を
 * 見つける。新しいテーブルは持たず、既存の transactions を毎回集計する
 * (domain/spending.ts・domain/briefs.ts と同じ、都度計算の考え方)。
 *
 * 価格改定があった場合は「別のサブスク」として扱う(同じ店でも金額が
 * 変われば別グループになる)。厳密な追跡より、まず気づけることを優先する。
 */

import { addMonths, daysBetween, type DateOnly } from '@/lib/date';

export type SubscriptionTransaction = {
  merchantName: string | null;
  description: string;
  amountYen: number;
  occurredOn: DateOnly;
  isTransfer: boolean;
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
};

export type DetectedSubscription = {
  /** グループの識別子(店名/摘要の正規化 + 金額)。alerts の dedup_key にそのまま使う。 */
  key: string;
  label: string;
  /** 1回あたりの金額(円、正の数)。 */
  amountYen: number;
  /** 連続して検知できた回数。 */
  occurrenceCount: number;
  lastOccurredOn: DateOnly;
  /** 前回の周期から1ヶ月後の見込み日。 */
  nextExpectedOn: DateOnly;
};

/** 連続とみなす間隔(日)。月によって28〜31日ぶれるため幅を持たせる。 */
const MIN_INTERVAL_DAYS = 25;
const MAX_INTERVAL_DAYS = 35;
/** これ未満の連続回数では「たまたま」と区別できないため検知しない。 */
const MIN_OCCURRENCES = 2;

/**
 * 明細から定期支払いを検知する。振替・ignored・収入は対象外
 * (domain/budget.ts の isCountable() と同じ判定基準)。
 */
export function detectSubscriptions(
  transactions: readonly SubscriptionTransaction[],
): DetectedSubscription[] {
  const groups = new Map<string, SubscriptionTransaction[]>();

  for (const t of transactions) {
    if (t.isTransfer || t.reviewStatus === 'ignored' || t.amountYen >= 0) continue;
    const label = (t.merchantName ?? t.description).trim();
    if (label === '') continue;

    const key = `${normalizeLabel(label)}:${t.amountYen}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const results: DetectedSubscription[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));

    let runStart = 0;
    for (let i = 1; i <= sorted.length; i += 1) {
      const brokeRun =
        i === sorted.length || !isMonthlyInterval(sorted[i - 1]!.occurredOn, sorted[i]!.occurredOn);
      if (!brokeRun) continue;

      const run = sorted.slice(runStart, i);
      if (run.length >= MIN_OCCURRENCES) {
        const last = run[run.length - 1]!;
        results.push({
          key,
          label: (last.merchantName ?? last.description).trim(),
          amountYen: Math.abs(last.amountYen),
          occurrenceCount: run.length,
          lastOccurredOn: last.occurredOn,
          nextExpectedOn: addMonths(last.occurredOn, 1),
        });
      }
      runStart = i;
    }
  }

  return results.sort((a, b) => b.lastOccurredOn.localeCompare(a.lastOccurredOn));
}

function isMonthlyInterval(a: DateOnly, b: DateOnly): boolean {
  const days = daysBetween(a, b);
  return days >= MIN_INTERVAL_DAYS && days <= MAX_INTERVAL_DAYS;
}

function normalizeLabel(label: string): string {
  return label.replace(/[\s　]/g, '').toLowerCase();
}

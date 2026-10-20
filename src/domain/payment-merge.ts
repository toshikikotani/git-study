/**
 * 同じ支払いを1件にするルール(v4 の共通の土台1、ADR-129)。レシート(品目あり)と、支払いの知らせ
 * (カードの通知メール)が、同じ日・同じ金額・そろえた店名で重なったら、自動で1件にまとめる。
 * 支払いの方を残し、品目と画像をそこに付ける。
 *
 * 自信がないとき(金額が少し違う・日付がずれる・店名がそろわない・相手が2つ以上ある)はまとめず、
 * いまの重複の候補(確認が必要)に回す。DBにもネットワークにも触れない。
 */

import { comparableKey, normalizeStoreName } from '@/domain/store-name';
import type { DateOnly } from '@/lib/date';

export type MergeCandidate = {
  id: string;
  occurredOn: DateOnly;
  amountYen: number;
  merchantName: string | null;
  description: string;
};

/** 店名をそろえる(チェーン名・支店を外す・全角半角・記号)。 */
export function mergeStoreKey(row: Pick<MergeCandidate, 'merchantName' | 'description'>): string {
  const raw = (row.merchantName ?? '').trim() || row.description;
  const normalized = normalizeStoreName(raw).name;
  return comparableKey(normalized || raw);
}

export type MergePair = { payment: MergeCandidate; receipt: MergeCandidate };

/**
 * まとめる組を選ぶ。1つのレシートに合う支払いが1つだけ、その支払いに合うレシートも1つだけのときに限る
 * (同じ日に同じ店で同じ額を2回払ったときなどは、どれとどれか決められないのでまとめない)。
 */
export function findMergePairs(
  payments: readonly MergeCandidate[],
  receipts: readonly MergeCandidate[],
): MergePair[] {
  const same = (a: MergeCandidate, b: MergeCandidate) =>
    a.occurredOn === b.occurredOn &&
    a.amountYen === b.amountYen &&
    a.amountYen !== 0 &&
    mergeStoreKey(a) !== '' &&
    mergeStoreKey(a) === mergeStoreKey(b);

  const pairs: MergePair[] = [];
  for (const receipt of receipts) {
    const matches = payments.filter((p) => p.id !== receipt.id && same(p, receipt));
    if (matches.length !== 1) continue;
    const payment = matches[0]!;
    const rivals = receipts.filter((r) => r.id !== payment.id && same(payment, r));
    if (rivals.length !== 1) continue;
    pairs.push({ payment, receipt });
  }
  return pairs;
}

/** 答え合わせのカードに添える説明(例:「カードの通知メールの453円と同じ支払いなので、1件にまとめました」)。 */
export function mergedNoteText(amountYen: number): string {
  return `カードの通知メールの${Math.abs(amountYen).toLocaleString('ja-JP')}円と同じ支払いなので、1件にまとめました`;
}

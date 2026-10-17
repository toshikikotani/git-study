import type { AttentionSummary } from './views';

export type AttentionReason = 'uncategorized' | 'mismatch';
export type AttentionQueueItem<T> = { tx: T; reasons: AttentionReason[] };

/** 一つの買い物のカテゴリと差額は、同じ記録の確認として扱う。 */
export function groupAttentionQueue<T extends { id: string }>(
  transactions: readonly T[],
  attention: AttentionSummary,
): AttentionQueueItem<T>[] {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const grouped = new Map<string, AttentionQueueItem<T>>();
  for (const reason of ['uncategorized', 'mismatch'] as const) {
    for (const id of attention[reason].ids) {
      const tx = byId.get(id);
      if (!tx) continue;
      const entry = grouped.get(id) ?? { tx, reasons: [] };
      entry.reasons.push(reason);
      grouped.set(id, entry);
    }
  }
  return [...grouped.values()];
}

/** 片方を直しても、同じ記録に残るもう片方の確認を飛ばさない。 */
export function remainingAttentionQueue<T extends { id: string }>(
  queue: readonly AttentionQueueItem<T>[],
  handled: ReadonlySet<string>,
): { tx: T; reasons: AttentionReason[]; reason: AttentionReason }[] {
  return queue.flatMap((item) => {
    const reason = item.reasons.find((r) => !handled.has(`${r}:${item.tx.id}`));
    return reason ? [{ ...item, reason }] : [];
  });
}

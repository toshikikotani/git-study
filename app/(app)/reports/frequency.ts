import type { LedgerTransaction } from '@/features/spending/ledger-types';
import type { BubblePoint } from './bubble-chart';

/** その月のカテゴリごとの回数と1回の金額(支出だけ。入力待ち・振替・対象外は除く)。 */
export function frequencyPoints(transactions: readonly LedgerTransaction[]): BubblePoint[] {
  const byGenre = new Map<string, { name: string; count: number; total: number }>();
  for (const tx of transactions) {
    if (tx.amountYen >= 0 || tx.isTransfer || tx.reviewStatus === 'ignored' || tx.needsInput)
      continue;
    if (tx.status === 'scheduled') continue;
    const name = tx.genreName ?? '未分類';
    const key = tx.genreId ?? name;
    const cur = byGenre.get(key) ?? { name, count: 0, total: 0 };
    cur.count += 1;
    cur.total += -tx.amountYen;
    byGenre.set(key, cur);
  }
  return [...byGenre.entries()].map(([id, g]) => ({
    genreId: id,
    name: g.name,
    frequency: g.count,
    avgYen: Math.round(g.total / g.count),
    totalYen: g.total,
  }));
}

/** 「食料品は回数が多く、娯楽・趣味は1回が高め」。カテゴリが2つ未満なら null。 */
export function frequencySummary(points: readonly BubblePoint[]): string | null {
  if (points.length < 2) return null;
  const often = [...points].sort((a, b) => b.frequency - a.frequency)[0]!;
  const pricey = [...points]
    .filter((p) => p.genreId !== often.genreId)
    .sort((a, b) => b.avgYen - a.avgYen)[0]!;
  return `${often.name}は回数が多く、${pricey.name}は1回が高め`;
}

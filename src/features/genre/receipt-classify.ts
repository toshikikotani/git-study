import type { ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import { ClaudeGenreClassifier, type GenreClassifiable, type GenreOption } from './genre-ai';

/**
 * レシート登録時のジャンル分類(本人発案「レシート登録時に分類もして欲しい」)。
 * 読み取り直後に、保存前のプレビューへジャンルを先に埋めておくための分類で、
 * 本人は保存前に選び直せる。DBには触れない(保存は取り込み画面が行う)。
 *
 * 分類の単位は /reports/genres の一括分類と同じ:商品行(品目)がある明細は
 * 品目ごと、無い明細は明細全体。
 */

/** 分類対象の識別子。明細は `${i}`、明細 i の品目 j は `${i}:${j}`。 */
export type ReceiptTargetKey = string;

export type ReceiptClassification = {
  key: ReceiptTargetKey;
  genreId: string;
  confidence: number;
};

export function buildReceiptTargets(
  transactions: readonly ParsedReceiptTransaction[],
): GenreClassifiable[] {
  const targets: GenreClassifiable[] = [];
  transactions.forEach((t, i) => {
    if (t.items.length === 0) {
      targets.push({ id: `${i}`, label: t.description, amountYen: t.amountYen });
      return;
    }
    t.items.forEach((item, j) => {
      targets.push({ id: `${i}:${j}`, label: item.description, amountYen: item.amountYen });
    });
  });
  return targets;
}

export async function classifyReceiptTransactions(
  apiKey: string,
  transactions: readonly ParsedReceiptTransaction[],
  genreOptions: readonly GenreOption[],
): Promise<{ classifications: ReceiptClassification[]; warnings: string[] }> {
  const targets = buildReceiptTargets(transactions);
  if (targets.length === 0) return { classifications: [], warnings: [] };

  const outcome = await new ClaudeGenreClassifier(apiKey).classifyMany(targets, genreOptions);
  return {
    classifications: outcome.classifications.map((c) => ({
      key: c.id,
      genreId: c.genreId,
      confidence: c.confidence,
    })),
    warnings: outcome.warnings,
  };
}

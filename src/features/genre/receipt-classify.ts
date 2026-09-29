import { STORE_TYPE_GENRE } from '@/domain/classification-dictionary';
import {
  classifyLine,
  type ClassificationMemory,
  type ClassificationSource,
} from '@/domain/classification-pipeline';
import { normalizeStoreName } from '@/domain/store-name';
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

export type PipelineClassification = ReceiptClassification & { source: ClassificationSource };

export type ReceiptPipelineResult = {
  /** 明細(親)の初期ジャンル(店の種類から)。決まらなければ null。 */
  parentGenreIds: Map<number, string>;
  classifications: PipelineClassification[];
  warnings: string[];
};

/**
 * 分類パイプライン(利用者のルール → 個人の履歴 → 品目辞書 → AI 推定)を当てる。
 * AI は前の3段で決まらなかった対象だけに使う(apiKey が null なら使わない)。
 * 最後まで決まらない品目は、店の種類から決めた親のジャンルを引き継ぐ
 * (「(未分類)」の子を作らない)。DB には触れない(記憶は呼び出し側が渡す)。
 */
export async function classifyReceiptPipeline(
  apiKey: string | null,
  transactions: readonly ParsedReceiptTransaction[],
  genreOptions: readonly GenreOption[],
  memory: ClassificationMemory,
): Promise<ReceiptPipelineResult> {
  const genreIdByName = new Map(genreOptions.map((g) => [g.name, g.id]));
  const ctx = { memory, genreIdByName };
  const classifications: PipelineClassification[] = [];
  const parentGenreIds = new Map<number, string>();
  const warnings: string[] = [];
  const undecided: GenreClassifiable[] = [];
  const undecidedStore = new Map<string, string>();

  transactions.forEach((t, i) => {
    const store = t.storeName ?? normalizeStoreName(t.description).name;
    const storeType = normalizeStoreName(t.description).type;
    const typeGenreName = STORE_TYPE_GENRE[storeType];
    const typeGenreId = typeGenreName === null ? undefined : genreIdByName.get(typeGenreName);
    if (typeGenreId !== undefined) parentGenreIds.set(i, typeGenreId);

    const targets =
      t.items.length === 0
        ? [{ key: `${i}`, label: t.description, amountYen: t.amountYen }]
        : t.items.map((item, j) => ({
            key: `${i}:${j}`,
            label: item.description,
            amountYen: item.amountYen,
          }));
    for (const target of targets) {
      const hit = classifyLine(store, target.label, ctx);
      if (hit !== null) {
        classifications.push({
          key: target.key,
          genreId: hit.genreId,
          confidence: hit.confidence,
          source: hit.source,
        });
      } else {
        undecided.push({ id: target.key, label: target.label, amountYen: target.amountYen });
        undecidedStore.set(target.key, store);
      }
    }
  });

  let aiDone = new Set<string>();
  if (undecided.length > 0 && apiKey !== null) {
    try {
      const outcome = await new ClaudeGenreClassifier(apiKey).classifyMany(undecided, genreOptions);
      warnings.push(...outcome.warnings);
      for (const c of outcome.classifications) {
        classifications.push({
          key: c.id,
          genreId: c.genreId,
          confidence: c.confidence,
          source: 'ai',
        });
      }
      aiDone = new Set(outcome.classifications.map((c) => c.id));
    } catch {
      warnings.push('AI によるジャンル推定ができませんでした。店の種類から仮に入れています。');
    }
  }

  // どれにも当たらなかった対象は、店の種類の初期ジャンルを仮に入れる。
  for (const target of undecided) {
    if (aiDone.has(target.id)) continue;
    const parentIndex = Number(target.id.split(':')[0]);
    const genreId = parentGenreIds.get(parentIndex);
    if (genreId !== undefined) {
      classifications.push({ key: target.id, genreId, confidence: 0.5, source: 'store_type' });
    }
  }

  return { parentGenreIds, classifications, warnings };
}

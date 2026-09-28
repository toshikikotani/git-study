/**
 * 明細・レシート品目の客観的なジャンル分類(本人発案「投資家目線で客観的に
 * ジャンル細分化するAIを作ってほしい」、ADR-056)。
 *
 * `features/classification/ai.ts`(ルールに当たらなかった明細をカテゴリへ
 * 振り分けるAI)と同じ「本人が管理する選択肢からモデルに1つ選ばせるだけ」の
 * 分類タスクのため、同じくモデルは Haiku(ADR-010:分類=Haiku、推論・相談=Sonnet)。
 * ジャンルの選択肢は固定enumではなく本人が自由に追加・削除できる `genres`
 * テーブル(features/genre/store.ts)で管理するため、classification/ai.ts と
 * 同じく実行時に選択肢を受け取り、モデルには名前で選ばせて呼び出し側で
 * id へ解決する(uuid をモデルへ見せない、resolveCategoryByName() と同じ考え方)。
 * 浪費/必要経費の診断(diagnosis-ai.ts)と違い「これは何の商品か」という
 * 事実に近い判断で、理由付けを本人に見せる価値が薄いため reasoning は
 * 持たせない(出力が軽い分、1回の操作でより多く処理できる)。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { parseStructured } from '@/lib/anthropic';

/** ジャンル分類に使うモデル(ADR-056)。日付サフィックスは付けない。 */
export const GENRE_CLASSIFICATION_MODEL = 'claude-haiku-4-5';

/** 1回のリクエストに含める件数。reasoning が無く出力が軽いため、
 * classification/ai.ts(40件)より多めにできる。 */
export const DEFAULT_BATCH_SIZE = 60;
const OUTPUT_TOKENS_PER_ITEM = 30;
const MIN_OUTPUT_TOKENS = 512;

/** ジャンルの選択肢。呼び出し側が本人の genres 一覧を渡す(ここでは DB を読まない)。 */
export type GenreOption = { id: string; name: string };

export type GenreClassifiable = {
  id: string;
  /** レシート品目なら品目名、明細全体なら店名(無ければ摘要)。 */
  label: string;
  /** 正の金額(判断の参考情報)。 */
  amountYen: number;
};

export type GenreClassification = { id: string; genreId: string };

export type BatchGenreClassifyResult = {
  classifications: GenreClassification[];
  /** 分類できなかった行・失敗したバッチの理由。黙って捨てない(NFR-06)。 */
  warnings: string[];
};

const rowSchema = z.object({
  id: z.string().describe('渡された id をそのまま返す。存在しない id を作らない。'),
  genre_name: z.string().describe('渡されたジャンルの選択肢の名前のいずれかと完全に一致させること'),
});

const batchSchema = z.object({
  classifications: z.array(rowSchema).describe('入力と同じ順序・同じ件数で返す'),
});

type BatchRow = z.infer<typeof rowSchema>;

const SYSTEM_PROMPT_HEADER = [
  'あなたは家計簿アプリの支出を、客観的な商品・サービスのジャンルに仕分ける担当です。',
  '本人が付けたカテゴリ名(生活費・浪費など)は主観的な分類であり、ここでのジャンルは',
  'それとは独立した、内容そのものから見た機械的な分類です。カテゴリ名に引きずられず、',
  '店名・品目名・金額から実際に何を買った支出かで判断してください。',
  '',
  '守ること:',
  '- 渡されたジャンルの選択肢の中から最も当てはまるものを1つだけ選ぶ',
  '- 選択肢に無いジャンル名を作らない。名前は選択肢の表記と完全に一致させる',
  '- 入力した順序・件数のまま必ず返す。1件も飛ばさない',
].join('\n');

/**
 * Claude を使う実装。サーバー側でのみ生成すること(NFR-04)。
 */
export class ClaudeGenreClassifier {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  /**
   * 対象を batchSize 件ずつに分けて分類する(classification/ai.ts の
   * classifyMany() と同じ、1バッチの失敗が他のバッチを止めない設計)。
   */
  async classifyMany(
    targets: readonly GenreClassifiable[],
    genreOptions: readonly GenreOption[],
    options?: { batchSize?: number },
  ): Promise<BatchGenreClassifyResult> {
    if (genreOptions.length === 0) {
      return {
        classifications: [],
        warnings: ['ジャンルが1件も登録されていません。先にジャンルを追加してください。'],
      };
    }

    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    const classifications: GenreClassification[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      const result = await this.classifyBatch(batch, genreOptions);
      classifications.push(...result.classifications);
      warnings.push(...result.warnings);
    }

    return { classifications, warnings };
  }

  private async classifyBatch(
    targets: readonly GenreClassifiable[],
    genreOptions: readonly GenreOption[],
  ): Promise<BatchGenreClassifyResult> {
    if (targets.length === 0) return { classifications: [], warnings: [] };

    const maxTokens = Math.max(MIN_OUTPUT_TOKENS, targets.length * OUTPUT_TOKENS_PER_ITEM);
    const system = [
      SYSTEM_PROMPT_HEADER,
      '',
      'ジャンルの選択肢:',
      genreOptions.map((g) => `- ${g.name}`).join('\n'),
    ].join('\n');

    const result = await parseStructured({
      client: this.client,
      model: GENRE_CLASSIFICATION_MODEL,
      maxTokens,
      system,
      messages: [{ role: 'user', content: buildUserContent(targets) }],
      schema: batchSchema,
      hints: {
        truncated: `(${targets.length}件のバッチ)`,
        rateLimit: '次回のジャンル分類で再試行します。',
      },
    });
    if (!result.ok) return { classifications: [], warnings: [result.message] };

    return buildFromAiRows(result.value.classifications, targets, genreOptions);
  }
}

function buildUserContent(targets: readonly GenreClassifiable[]): string {
  const lines = targets.map((t) => `id=${t.id} 内容=${t.label} 金額=${Math.abs(t.amountYen)}円`);
  return ['以下それぞれについて、最も当てはまるジャンルを選んでください。', ...lines].join('\n');
}

/**
 * モデルの返答を検証する(classification/ai.ts の toClassification() と同じ
 * 「モデルの出力を信用しきらない」考え方)。存在しない id・重複した id・
 * 選択肢に無いジャンル名の行は捨てる(当て推量で解決しない)。要求件数に
 * 満たなくても届いた分だけ保存し、残りは次回のボタン操作で拾える。
 */
export function buildFromAiRows(
  rows: readonly BatchRow[],
  requested: readonly GenreClassifiable[],
  genreOptions: readonly GenreOption[],
): BatchGenreClassifyResult {
  const requestedIds = new Set(requested.map((t) => t.id));
  const idByName = new Map(genreOptions.map((g) => [g.name.trim(), g.id]));
  const seen = new Set<string>();
  const classifications: GenreClassification[] = [];

  for (const row of rows) {
    if (!requestedIds.has(row.id) || seen.has(row.id)) continue;
    const genreId = idByName.get(row.genre_name.trim());
    if (genreId === undefined) continue;
    seen.add(row.id);
    classifications.push({ id: row.id, genreId });
  }

  const warnings: string[] = [];
  const missing = requested.length - classifications.length;
  if (missing > 0) {
    warnings.push(
      `${missing}件は分類結果を受け取れませんでした。もう一度「ジャンル分類する」を押すと拾えることがあります。`,
    );
  }

  return { classifications, warnings };
}

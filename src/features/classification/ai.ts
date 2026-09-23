/**
 * ルールに当たらなかった明細の AI 分類(FR-11, FR-12, M2-4)。
 *
 * ── なぜルールの後に AI を置くのか ────────────────────────────
 * classification_rules で分類できるものは、ここに来る前に片付いている
 * (features/classification/rules.ts の docs コメント参照)。ここに来るのは
 * ルールの語彙に無い摘要だけなので、呼ぶ頻度も費用も自然に下がる。
 *
 * ── 役割分担 ───────────────────────────────────────────────
 * AI がやること   摘要からカテゴリの code を選び、確信度を返す
 * AI がやらないこと 確信度が閾値を超えたかどうかの判定
 * 閾値判定は呼び出し側が行う(app_settings.classification_confidence_threshold)。
 * ここでは「AI がどう思ったか」だけを返し、「それを信用するか」は混ぜない。
 * confidence が無いまま classified_by='ai' として保存することは DB 制約
 * (ck_transactions_ai_needs_confidence)が拒む。ここで confidence を必ず
 * 添えて返すのは、その制約を素直に満たすため。
 *
 * ── なぜ code で答えさせるのか(id ではなく) ─────────────────
 * カテゴリ id は uuid で、100件分をやり取りすると本文に占める割合が
 * 大きくなる。code は 'living' のような短い不変の識別子で、本人が
 * カテゴリを改名しても変わらない(ADR-016)。id への変換はここで行い、
 * モデルには一度も uuid を見せない。
 *
 * ── バッチと相関 ─────────────────────────────────────────────
 * 送った順番のまま同じ件数で返すよう指示し、返答件数が一致しなければ
 * その回はまとめて失敗として扱う(部分的な対応付けの当て推量をしない)。
 * 100件を1回で送ると出力が長くなりすぎるため、既定 40 件ずつに分けて
 * 複数リクエストにする(DoD:100件が3リクエスト以内)。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { parseStructured } from '@/lib/anthropic';
import { AppError } from '@/lib/errors';

/** 分類に使う既定モデル。日付サフィックスは付けない(ADR-010)。 */
export const DEFAULT_CLASSIFICATION_MODEL = 'claude-haiku-4-5';

/** 1回のリクエストに含める明細数。DoD の「100件を3リクエスト以内」を満たす値。 */
export const DEFAULT_BATCH_SIZE = 40;

/** 1回のリクエストの出力上限。バッチ件数に比例して抑える。 */
const OUTPUT_TOKENS_PER_ITEM = 40;
const MIN_OUTPUT_TOKENS = 512;

export type ClassifiableTransaction = {
  id: string;
  description: string;
  merchantName: string | null;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
};

/** 分類の選択肢。呼び出し側が対象カテゴリを選んで渡す(ここでは DB を読まない)。 */
export type CategoryOption = {
  code: string;
  name: string;
};

export type AiClassification = {
  transactionId: string;
  /** 該当するカテゴリが無いとモデルが判断した場合は null(本人の確認へ回す)。 */
  categoryCode: string | null;
  /** 0〜1。categoryCode が null の行も含め、モデルが答えた確信度。 */
  confidence: number;
};

export type BatchClassifyResult = {
  classifications: AiClassification[];
  /** 分類できなかった行・失敗したバッチの理由。黙って捨てない(NFR-06)。 */
  warnings: string[];
  inputTokens: number;
  outputTokens: number;
  /** 実際に投げたリクエスト数。job_runs.detail に残す想定(呼び出し側の責務)。 */
  requestCount: number;
};

const classificationRowSchema = z.object({
  category_code: z
    .string()
    .describe('選んだカテゴリの code。渡された選択肢の中から選ぶ。該当が無ければ空文字'),
  confidence: z.number().min(0).max(1).describe('0〜1の確信度。自信が無いほど低い値を返す'),
});

const batchSchema = z.object({
  classifications: z
    .array(classificationRowSchema)
    .describe('入力した明細と同じ順序・同じ件数で返す'),
});

type BatchRow = z.infer<typeof classificationRowSchema>;

const SYSTEM_PROMPT = [
  'あなたは家計簿アプリの明細分類の担当です。',
  '',
  '守ること:',
  '- 摘要・利用先・金額から、渡されたカテゴリの選択肢の中から最も当てはまる code を選ぶ',
  '- 選択肢に無い code を作らない。当てはまるものが無ければ category_code を空文字にする',
  '- confidence は「その分類にどれだけ自信があるか」の 0〜1。分からなければ低い値を返す',
  '  (0 にする必要はない。分類は付けつつ自信の無さを confidence で表す)',
  '- 入力した明細と同じ順序・同じ件数で必ず返す。1件も飛ばさない',
].join('\n');

export class AiClassificationError extends AppError {}

/**
 * Claude を使う実装。サーバー側でのみ生成すること(NFR-04)。
 */
export class ClaudeTransactionClassifier {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  /**
   * 対象を batchSize 件ずつに分けて分類する。
   * 1バッチの失敗は warnings に理由を残し、他のバッチは続行する
   * (1件のエラーで残り99件の分類が止まらないようにする)。
   */
  async classifyMany(
    transactions: readonly ClassifiableTransaction[],
    categories: readonly CategoryOption[],
    options?: { model?: string; batchSize?: number },
  ): Promise<BatchClassifyResult> {
    const model = options?.model ?? DEFAULT_CLASSIFICATION_MODEL;
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;

    const result: BatchClassifyResult = {
      classifications: [],
      warnings: [],
      inputTokens: 0,
      outputTokens: 0,
      requestCount: 0,
    };

    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = transactions.slice(i, i + batchSize);
      const batchResult = await this.classifyBatch(batch, categories, model);
      result.classifications.push(...batchResult.classifications);
      result.warnings.push(...batchResult.warnings);
      result.inputTokens += batchResult.inputTokens;
      result.outputTokens += batchResult.outputTokens;
      result.requestCount += 1;
    }

    return result;
  }

  /** 1リクエスト分。件数超過の分割は classifyMany が行う。 */
  private async classifyBatch(
    transactions: readonly ClassifiableTransaction[],
    categories: readonly CategoryOption[],
    model: string,
  ): Promise<Omit<BatchClassifyResult, 'requestCount'>> {
    if (transactions.length === 0) {
      return { classifications: [], warnings: [], inputTokens: 0, outputTokens: 0 };
    }

    const maxTokens = Math.max(MIN_OUTPUT_TOKENS, transactions.length * OUTPUT_TOKENS_PER_ITEM);

    const result = await parseStructured({
      client: this.client,
      model,
      maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(transactions, categories) }],
      schema: batchSchema,
      hints: {
        truncated: `(${transactions.length}件のバッチ)`,
        rateLimit: '次回のジョブで再試行します。',
      },
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    if (!result.ok) {
      return { classifications: [], warnings: [result.message], ...usage };
    }
    const parsed = result.value;

    if (parsed.classifications.length !== transactions.length) {
      return {
        classifications: [],
        warnings: [
          `AI の返答件数が入力と一致しませんでした(入力${transactions.length}件 / 返答${parsed.classifications.length}件)。当て推量で対応付けないため、このバッチは全て未分類のままにします。`,
        ],
        ...usage,
      };
    }

    const codes = new Set(categories.map((c) => c.code));
    const classifications = transactions.map((tx, index) =>
      toClassification(tx.id, parsed.classifications[index]!, codes),
    );

    return { classifications, warnings: [], ...usage };
  }
}

function toClassification(
  transactionId: string,
  row: BatchRow,
  validCodes: ReadonlySet<string>,
): AiClassification {
  const code = row.category_code.trim();
  // 選択肢に無い code を返してきた場合、存在しないカテゴリを指すより
  // 「分類できなかった」扱いにする方が安全(本人の確認へ回る)。
  const categoryCode = code !== '' && validCodes.has(code) ? code : null;
  return { transactionId, categoryCode, confidence: row.confidence };
}

function buildUserMessage(
  transactions: readonly ClassifiableTransaction[],
  categories: readonly CategoryOption[],
): string {
  const categoryLines = categories.map((c) => `- ${c.code}: ${c.name}`).join('\n');
  const transactionLines = transactions
    .map((tx, index) => {
      const merchant = tx.merchantName ? ` / 利用先: ${tx.merchantName}` : '';
      return `${index + 1}. 摘要: ${tx.description}${merchant} / 金額: ${tx.amountYen}円`;
    })
    .join('\n');

  return [
    'カテゴリの選択肢:',
    categoryLines,
    '',
    `明細(${transactions.length}件、この順序のまま同じ件数で返すこと):`,
    transactionLines,
  ].join('\n');
}

/**
 * AiClassification を、実際の分類結果へ変換する。
 *
 * 以前は確信度が閾値未満だと「確認待ち」(review_status='pending')に
 * 回していたが、本人発案「確認待ちのやつあるけど、あれもうなくして。もう
 * AI が勝手にやっていい。それが気に食わんかったら編集する」(ADR-045)により
 * 撤廃した。AI が答えたならそのまま `auto_ok` として適用し、直すかどうかは
 * 本人が明細を見て編集するかどうかに委ねる(receipt-items-panel.tsx の
 * 編集ダイアログ・split-editor.tsx の「カテゴリを変更する」がいつでも開ける)。
 */
export type AppliedClassification = {
  categoryCode: string | null;
  confidence: number;
  classifiedBy: 'ai' | 'unclassified';
};

export function toAppliedClassification(classification: AiClassification): AppliedClassification {
  if (classification.categoryCode === null) {
    return {
      categoryCode: null,
      confidence: classification.confidence,
      classifiedBy: 'unclassified',
    };
  }
  return {
    categoryCode: classification.categoryCode,
    confidence: classification.confidence,
    classifiedBy: 'ai',
  };
}

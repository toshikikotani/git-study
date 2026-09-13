/**
 * レシート・領収書の画像からの AI 抽出(新機能、ADR-021)。
 *
 * ── なぜ画像なのか ──────────────────────────────────────────
 * 明細の取り込み経路(CSV・メール通知)は、いずれもカード払いの記録を前提に
 * している。現金払い・電子マネー払いにはそもそも通知メールが届かず、
 * カード明細にも載らない。この抜け穴を埋めるには、レシートの写真を直接
 * 読み取る経路が要る(設計原則2「記録の手間を最小化」)。
 *
 * ── email-ai.ts との違い ────────────────────────────────────
 * メール通知にはラベル辞書という費用ゼロの経路があり、AI は「辞書が読めな
 * かったときだけ」の救済役だった(ADR-019)。レシート画像には辞書に相当する
 * ものが無い(画像からの決定的な文字抽出手段を持たない)ため、この経路は
 * 呼ばれた時点で必ず AI を使う。ADR-010 の「リボ・キャッシングの判定は
 * AI にやらせない」という役割分担はここでも変えない。payment_method_text は
 * レシートにそう書かれていた文字列そのままを返させ、判定は従来どおり
 * readPaymentMethod の正規表現が行う。
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { DateOnly } from '@/lib/date';
import { readPaymentMethod, type PaymentMethod } from './adapters';
import { parseDateOnly } from './date-parse';

/** 抽出に使うモデル(ADR-010/019 と同じコスト方針)。日付サフィックスは付けない。 */
export const RECEIPT_EXTRACTION_MODEL = 'claude-haiku-4-5';

/** 1枚あたりの上限。書き写すだけの作業なので、長い出力は異常。 */
const MAX_OUTPUT_TOKENS = 2048;

/**
 * 明らかに桁を外した金額を弾くための上限(1件 1000万円)。
 * email-ai.ts と同じ理由(カンマの読み違い等の事故を本人の目に触れる前に止める)。
 */
const MAX_AMOUNT_YEN = 10_000_000;

export const SUPPORTED_RECEIPT_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ReceiptMediaType = (typeof SUPPORTED_RECEIPT_MEDIA_TYPES)[number];

export type ParsedReceiptTransaction = {
  occurredOn: DateOnly;
  description: string;
  /** 支出が負(ADR-008)。レシートは常に支出として扱う。 */
  amountYen: number;
  paymentMethod: PaymentMethod;
};

export type ReceiptParseResult = {
  transactions: ParsedReceiptTransaction[];
  /** 取りこぼしを黙って捨てないための記録。画面に出す。 */
  warnings: string[];
};

export type AiReceiptExtractInput = {
  imageBase64: string;
  mediaType: ReceiptMediaType;
};

export interface AiReceiptExtractor {
  extract(input: AiReceiptExtractInput): Promise<ReceiptParseResult>;
}

/**
 * モデルに返させる形。
 *
 * payment_method_text が enum ではなく string なのが要点(email-ai.ts と同じ理由)。
 */
const rowSchema = z.object({
  occurred_on: z.string().describe('レシートに印字された日付。YYYY-MM-DD 形式。時刻は含めない。'),
  amount_yen: z
    .number()
    .describe(
      '実際に支払った合計金額(「合計」「お会計」「お預り」ではなく実際の支払額)。' +
        '小計・税抜金額ではなく、レシートの最終的な支払金額を返す。円単位の整数。',
    ),
  store_name: z
    .string()
    .describe('店名・発行元。レシートに書かれていた表記のまま。読み取れなければ空文字。'),
  payment_method_text: z
    .string()
    .describe(
      '支払方法としてレシートに書かれていた文字列を、そのまま写す。' +
        '言い換えや翻訳や要約はしない。書かれていなければ空文字。',
    ),
});

const extractionSchema = z.object({
  is_receipt: z
    .boolean()
    .describe('この画像がレシート・領収書であれば true。無関係な写真や読み取れない画像は false。'),
  transactions: z
    .array(rowSchema)
    .describe('読み取れた明細。1枚に複数の取引が写っていれば複数。無ければ空配列。'),
});

type ExtractionRow = z.infer<typeof rowSchema>;

const SYSTEM_PROMPT = [
  'あなたはレシート・領収書の画像から、支払い明細を書き写す担当です。',
  '',
  '守ること:',
  '- 画像に写っていることだけを返す。推測で補わない。',
  '- 金額は絶対値の整数。カンマや「円」は取り除く。小計や税抜額ではなく、実際に支払った合計を返す。',
  '- 日付は YYYY-MM-DD。和暦(令和・平成)や「9/3」のような表記は西暦に直すが、',
  '  年が画像のどこにも無ければその明細は返さない。',
  '- payment_method_text はレシートの文字列をそのまま写す。',
  '  「クレジット」を「credit card」に直すようなことはしない。',
  '- 1枚に複数のレシートが写っていれば、すべて返す。',
  '- レシート・領収書でない画像(無関係な写真、読み取れないほど不鮮明な画像など)は',
  '  is_receipt を false にして transactions を空にする。',
].join('\n');

/**
 * Claude を使う実装。
 *
 * サーバー側でのみ生成すること。API キーがブラウザへ渡ることは無い(NFR-04)。
 */
export class ClaudeReceiptExtractor implements AiReceiptExtractor {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async extract(input: AiReceiptExtractInput): Promise<ReceiptParseResult> {
    let parsed: z.infer<typeof extractionSchema> | null;
    try {
      const response = await this.client.messages.parse({
        model: RECEIPT_EXTRACTION_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: input.mediaType,
                  data: input.imageBase64,
                },
              },
              { type: 'text', text: '上の画像から支払い明細を書き写してください。' },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(extractionSchema) },
      });

      if (response.stop_reason === 'max_tokens') {
        return { transactions: [], warnings: ['AI の出力が長すぎて途中で切れました。'] };
      }
      parsed = response.parsed_output;
    } catch (error) {
      return { transactions: [], warnings: [describeError(error)] };
    }

    if (parsed === null) {
      return { transactions: [], warnings: ['AI の返答を解釈できませんでした。'] };
    }
    if (!parsed.is_receipt) {
      return { transactions: [], warnings: ['レシート・領収書として認識できませんでした。'] };
    }

    return buildFromAiRows(parsed.transactions);
  }
}

/**
 * モデルの返答を明細に変換する。
 *
 * モデルの出力はスキーマに沿っているだけで、中身が正しい保証は無い。
 * 日付・金額はこちら側で必ず検証し、通らないものは理由を残して捨てる。
 * 支払方法はここで初めて正規表現にかけ、確率的な判定を混ぜない(ADR-010)。
 */
export function buildFromAiRows(rows: readonly ExtractionRow[]): ReceiptParseResult {
  const transactions: ParsedReceiptTransaction[] = [];
  const warnings: string[] = [];

  for (const row of rows) {
    let occurredOn: DateOnly;
    try {
      occurredOn = parseDateOnly(row.occurred_on);
    } catch {
      warnings.push(`AI が返した日付を解釈できませんでした: ${row.occurred_on}`);
      continue;
    }

    const amount = Math.abs(Math.round(row.amount_yen));
    if (!Number.isFinite(amount) || amount === 0) {
      warnings.push(`AI が返した金額が使えません(${row.amount_yen})`);
      continue;
    }
    if (amount > MAX_AMOUNT_YEN) {
      warnings.push(
        `AI が返した金額が大きすぎるため確認が要ります(${amount.toLocaleString('ja-JP')}円)`,
      );
      continue;
    }

    const description = row.store_name.trim();

    transactions.push({
      occurredOn,
      // レシートは支出(ADR-008)。符号はモデルに委ねない。
      amountYen: -amount,
      description: description === '' ? '(店名不明)' : description,
      // ここが FR-21 の砦。判定するのはモデルではなく正規表現(ADR-010)。
      paymentMethod: readPaymentMethod(row.payment_method_text),
    });
  }

  if (transactions.length === 0 && warnings.length === 0) {
    warnings.push('AI もこの画像から明細を読み取れませんでした。');
  }

  return { transactions, warnings };
}

/**
 * 失敗の理由を本人に見える言葉にする。
 * 取り込みジョブ全体を落とさず、その1枚だけを飛ばして続ける。
 */
function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'AI の API キーが無効です。ANTHROPIC_API_KEY を確認してください。';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'AI の利用上限に達しました。しばらくしてから再試行してください。';
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `AI への要求が受け付けられませんでした: ${error.message}`;
  }
  if (error instanceof Anthropic.APIError) {
    return `AI の呼び出しに失敗しました(${error.status}): ${error.message}`;
  }
  return `AI の呼び出しに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
}

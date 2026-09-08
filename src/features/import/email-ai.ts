/**
 * 通知メールの AI 抽出(FR-10 の救済経路、ADR-019)。
 *
 * ── なぜ AI を足すのか ──────────────────────────────────────
 * email.ts のラベル辞書は、発行元が様式を変えるたび・新しいカードを作るたびに
 * 取りこぼす。取りこぼしは「その月の支出が本人の目に入らない」ことを意味し、
 * 気づくのは翌月の請求額を見たときになる。辞書に1語足せば直るとはいえ、
 * 直すまでの間、記録が欠ける。
 *
 * ── なぜ AI に「全部」やらせないのか ────────────────────────
 * ADR-010:リボ・キャッシング・分割の検知(FR-21)は見逃しが致命的なので、
 * 確率的な出力に依存させない。そこでこう分ける:
 *
 *   AI がやること   本文から「日付・金額・店名・支払方法として書かれていた文字列」を取り出す
 *   AI がやらないこと それがリボかキャッシングかを判定する
 *
 * モデルには payment_method_text を「メールにそう書いてあった文字列そのまま」で
 * 返させ、リボ判定は従来どおり readPaymentMethod と分類ルールの正規表現が行う。
 * モデルが「リボ」を「revolving」と気を利かせて言い換えても、
 * 判定側は元の文字列だけを見るので、検知の確実性は変わらない。
 *
 * ── なぜ最安モデルなのか ────────────────────────────────────
 * やらせているのは「本文から4項目を書き写す」だけで、推論の余地がない。
 * claude-haiku-4-5 で足りる(ADR-019)。thinking も付けない。
 *
 * ── いつ呼ぶのか ────────────────────────────────────────────
 * ラベル辞書が1件も読めなかったときだけ。読めている大多数のメールでは
 * API を叩かないので、通常運転の費用はゼロのまま(分類の設計と同じ考え方)。
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { DateOnly } from '@/lib/date';
import { readPaymentMethod } from './adapters';
import { parseDateOnly } from './date-parse';
import type { EmailParseResult, ParsedEmailTransaction } from './email';

/** 抽出に使うモデル(ADR-019)。日付サフィックスは付けない。 */
export const EMAIL_EXTRACTION_MODEL = 'claude-haiku-4-5';

/** 1通あたりの上限。書き写すだけの作業なので、長い出力は異常。 */
const MAX_OUTPUT_TOKENS = 2048;

/** 本文をそのまま送らないための上限。通知メールは末尾が定型の広告で長い。 */
const MAX_BODY_CHARS = 6000;

/**
 * 明らかに桁を外した金額を弾くための上限(1件 1000万円)。
 * カンマの読み違いで 3,500 が 3500000 になるような事故を、
 * 本人の目に触れる前に止める。
 */
const MAX_AMOUNT_YEN = 10_000_000;

export type AiExtractInput = {
  body: string;
  subject?: string | undefined;
};

export interface AiEmailExtractor {
  extract(input: AiExtractInput): Promise<EmailParseResult>;
}

/**
 * モデルに返させる形。
 *
 * payment_method_text が enum ではなく string なのが要点。
 * 「リボ払い」「revolving」「2回払い」の区別はこちらの正規表現が付ける(ADR-010)。
 */
const rowSchema = z.object({
  occurred_on: z.string().describe('利用日。YYYY-MM-DD 形式。時刻は含めない。'),
  amount_yen: z.number().describe('利用金額。円単位の整数。符号は付けず絶対値で返す。'),
  description: z
    .string()
    .describe('利用先・店名。本文に書かれていた表記のまま。読み取れなければ空文字。'),
  payment_method_text: z
    .string()
    .describe(
      '支払方法として本文に書かれていた文字列を、そのまま写す。' +
        '言い換えや翻訳や要約はしない。書かれていなければ空文字。',
    ),
});

const extractionSchema = z.object({
  is_card_notification: z
    .boolean()
    .describe('このメールがカード等の利用通知であれば true。広告や明細案内だけなら false。'),
  transactions: z.array(rowSchema).describe('読み取れた利用明細。無ければ空配列。'),
});

type ExtractionRow = z.infer<typeof rowSchema>;

const SYSTEM_PROMPT = [
  'あなたはクレジットカード等の利用通知メールから、利用明細を書き写す担当です。',
  '',
  '守ること:',
  '- 本文に書かれていることだけを返す。推測で補わない。',
  '- 金額は絶対値の整数。カンマや「円」は取り除く。',
  '- 日付は YYYY-MM-DD。和暦や「9月3日」のような表記は西暦に直すが、',
  '  年が本文のどこにも無ければその明細は返さない。',
  '- payment_method_text は本文の文字列をそのまま写す。',
  '  「リボ払い」を「revolving」に直すようなことはしない。',
  '- 1通に複数の明細が並んでいれば、すべて返す。',
  '- 支払い予定額の案内・キャンペーン・ポイント通知など、実際の利用でないものは',
  '  is_card_notification を false にして transactions を空にする。',
].join('\n');

/**
 * Claude を使う実装。
 *
 * サーバー側でのみ生成すること。API キーがブラウザへ渡ることは無い(NFR-04)。
 */
export class ClaudeEmailExtractor implements AiEmailExtractor {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async extract(input: AiExtractInput): Promise<EmailParseResult> {
    const body = input.body.slice(0, MAX_BODY_CHARS);

    let parsed: z.infer<typeof extractionSchema> | null;
    try {
      const response = await this.client.messages.parse({
        model: EMAIL_EXTRACTION_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [input.subject === undefined ? null : `件名: ${input.subject}`, '本文:', body]
              .filter((line): line is string => line !== null)
              .join('\n'),
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
    if (!parsed.is_card_notification) {
      return { transactions: [], warnings: ['AI もカードの利用通知とは判断しませんでした。'] };
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
export function buildFromAiRows(rows: readonly ExtractionRow[]): EmailParseResult {
  const transactions: ParsedEmailTransaction[] = [];
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

    const description = row.description.trim();

    transactions.push({
      occurredOn,
      // 利用通知は支出(ADR-008)。符号はモデルに委ねない。
      amountYen: -amount,
      description: description === '' ? '(店名不明)' : description,
      // ここが FR-21 の砦。判定するのはモデルではなく正規表現(ADR-010)。
      paymentMethod: readPaymentMethod(row.payment_method_text),
    });
  }

  if (transactions.length === 0 && warnings.length === 0) {
    warnings.push('AI もこのメールから明細を読み取れませんでした。');
  }

  return { transactions, warnings };
}

/**
 * 失敗の理由を本人に見える言葉にする。
 * 取り込みジョブ全体を落とさず、そのメールだけを飛ばして続ける。
 */
function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'AI の API キーが無効です。ANTHROPIC_API_KEY を確認してください。';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'AI の利用上限に達しました。次回の取り込みで再試行します。';
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `AI への要求が受け付けられませんでした: ${error.message}`;
  }
  if (error instanceof Anthropic.APIError) {
    return `AI の呼び出しに失敗しました(${error.status}): ${error.message}`;
  }
  return `AI の呼び出しに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
}

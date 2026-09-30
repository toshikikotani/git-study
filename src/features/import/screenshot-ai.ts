/**
 * スクリーンショットからの取引の書き起こし(N3「スクショから記録」)。
 *
 * receipt-ai.ts(レシート・振込明細の画像抽出)と同じ「画像 → 構造化データ」
 * の型を使うが、対象が違う(決済アプリ・通販の注文完了・カード利用通知)ため
 * プロンプト・スキーマは分けた——receipt-ai.ts は商品行(items)・税率・
 * 照合(reconcileReceipt)という、レシート特有の作り込みを多く持っており、
 * それらをこちらの用途向けに全部持ち込むと無関係な複雑さが増える。
 * 「画像を渡して構造化データを受け取る」という骨格(parseStructuredGated
 * への image content block の渡し方)だけを踏襲する。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { assertDateOnly, type DateOnly } from '@/lib/date';
import { parseStructuredGated } from '@/lib/ai-gateway/gated';
import { SCREENSHOT_CAPTURE_PROMPT } from '@/prompts/screenshot-capture';

export const SCREENSHOT_CAPTURE_MODEL = 'claude-haiku-4-5';
const MAX_OUTPUT_TOKENS = 2048;
const MAX_AMOUNT_YEN = 10_000_000;

export const SUPPORTED_SCREENSHOT_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ScreenshotMediaType = (typeof SUPPORTED_SCREENSHOT_MEDIA_TYPES)[number];

export type ScreenshotCandidate = {
  occurredOn: DateOnly;
  amountYen: number;
  storeName: string;
  genreHint: string | null;
  confidence: number;
};

export type ScreenshotCaptureResult =
  | { candidates: ScreenshotCandidate[]; warnings: string[] }
  | { candidates: null; warnings: string[] };

const rowSchema = z.object({
  occurred_on: z.string().describe('YYYY-MM-DD。'),
  amount_yen: z.number().describe('円の整数(絶対値)。'),
  store_name: z.string().describe('支払先・出店者・加盟店名。読み取れなければ空文字。'),
  genre_hint: z.string().describe('渡されたジャンル一覧から最も近い名前。無ければ空文字。'),
  confidence: z.number().describe('この取引の読み取りの自信(0〜1)。'),
});

const extractionSchema = z.object({
  is_recognized: z
    .boolean()
    .describe('決済・注文・利用通知のいずれかの画面として認識できれば true。'),
  transactions: z.array(rowSchema).describe('読み取れた取引。無ければ空配列。'),
});

export interface ScreenshotCaptureAnalyzer {
  extract(input: {
    imageBase64: string;
    mediaType: ScreenshotMediaType;
    today: DateOnly;
    genreNames: readonly string[];
  }): Promise<ScreenshotCaptureResult>;
}

export class ClaudeScreenshotCaptureAnalyzer implements ScreenshotCaptureAnalyzer {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async extract(input: {
    imageBase64: string;
    mediaType: ScreenshotMediaType;
    today: DateOnly;
    genreNames: readonly string[];
  }): Promise<ScreenshotCaptureResult> {
    const result = await parseStructuredGated({
      client: this.client,
      model: SCREENSHOT_CAPTURE_MODEL,
      maxTokens: MAX_OUTPUT_TOKENS,
      system: SCREENSHOT_CAPTURE_PROMPT.text,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 },
            },
            {
              type: 'text',
              text: `今日の日付: ${input.today}\nジャンル一覧: ${input.genreNames.join('、')}\n\n上の画像から支払いの記録を書き写してください。`,
            },
          ],
        },
      ],
      schema: extractionSchema,
    });
    if (!result.ok) return { candidates: null, warnings: [result.message] };

    const parsed = result.value;
    if (!parsed.is_recognized) {
      return {
        candidates: [],
        warnings: ['決済・注文・利用通知の画面として認識できませんでした。'],
      };
    }
    return buildFromAiRows(parsed.transactions);
  }
}

export function buildFromAiRows(
  rows: readonly z.infer<typeof rowSchema>[],
): ScreenshotCaptureResult {
  const warnings: string[] = [];
  const candidates: ScreenshotCandidate[] = [];

  for (const row of rows) {
    let occurredOn: DateOnly;
    try {
      occurredOn = assertDateOnly(row.occurred_on);
    } catch {
      warnings.push(`日付を解釈できない取引を1件、読み込みから除きました。`);
      continue;
    }
    const amountYen = Math.round(Math.abs(row.amount_yen));
    if (!Number.isFinite(amountYen) || amountYen === 0 || amountYen > MAX_AMOUNT_YEN) {
      warnings.push(`金額を解釈できない取引を1件、読み込みから除きました。`);
      continue;
    }
    candidates.push({
      occurredOn,
      amountYen,
      storeName: row.store_name.trim(),
      genreHint: row.genre_hint.trim() === '' ? null : row.genre_hint.trim(),
      confidence: Math.max(0, Math.min(1, row.confidence)),
    });
  }

  return { candidates, warnings };
}

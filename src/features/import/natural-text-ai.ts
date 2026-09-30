/**
 * 自然文からの取引の書き起こし(N3「文字で記録」「話して記録」)。
 *
 * 「話して記録」は端末の音声認識(Web Speech API、端末内で完結)でテキスト化
 * したあと、ここに渡すだけ——入口が違うだけで後段はまったく同じ処理にした
 * (N1「端末内で処理できるものは端末内で処理する」、かつ重複した処理を
 * 持たない)。
 *
 * 数字の原則(N1):日付・金額はモデルの自由記述だが、AIに計算はさせない
 * ——文章に書かれている数字をそのまま拾うだけの書き起こしタスクとして
 * 扱う(receipt-ai.ts と同じ役割分担)。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { assertDateOnly, type DateOnly } from '@/lib/date';
import { parseStructuredGated } from '@/lib/ai-gateway/gated';
import { maskPii } from '@/lib/ai-gateway/privacy';
import { NATURAL_TEXT_CAPTURE_PROMPT } from '@/prompts/natural-text-capture';

export const NATURAL_TEXT_CAPTURE_MODEL = 'claude-haiku-4-5';
const MAX_OUTPUT_TOKENS = 2048;
const MAX_AMOUNT_YEN = 10_000_000;
/** 一度に受け付ける文章の上限(長文の貼り付け事故を防ぐ)。 */
export const MAX_INPUT_LENGTH = 2000;

export type NaturalTextCandidate = {
  occurredOn: DateOnly;
  amountYen: number;
  storeName: string;
  genreHint: string | null;
  confidence: number;
};

export type NaturalTextCaptureResult =
  | { candidates: NaturalTextCandidate[]; warnings: string[] }
  | { candidates: null; warnings: string[] };

const rowSchema = z.object({
  occurred_on: z.string().describe('YYYY-MM-DD。相対表現は「今日の日付」を基準に直す。'),
  amount_yen: z.number().describe('円の整数(絶対値)。'),
  store_name: z.string().describe('店名・支払先。分からなければ空文字。'),
  genre_hint: z.string().describe('渡されたジャンル一覧から最も近い名前。無ければ空文字。'),
  confidence: z.number().describe('この取引全体の読み取りの自信(0〜1)。'),
});

const extractionSchema = z.object({
  transactions: z.array(rowSchema).describe('文章から読み取れた取引。無ければ空配列。'),
});

export interface NaturalTextCaptureAnalyzer {
  extract(input: {
    text: string;
    today: DateOnly;
    genreNames: readonly string[];
  }): Promise<NaturalTextCaptureResult>;
}

export class ClaudeNaturalTextCaptureAnalyzer implements NaturalTextCaptureAnalyzer {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async extract(input: {
    text: string;
    today: DateOnly;
    genreNames: readonly string[];
  }): Promise<NaturalTextCaptureResult> {
    const text = input.text.trim().slice(0, MAX_INPUT_LENGTH);
    if (text === '') return { candidates: [], warnings: [] };

    const userContent = [
      `今日の日付: ${input.today}`,
      `ジャンル一覧: ${input.genreNames.join('、')}`,
      '',
      '文章:',
      maskPii(text),
    ].join('\n');

    const result = await parseStructuredGated({
      client: this.client,
      model: NATURAL_TEXT_CAPTURE_MODEL,
      maxTokens: MAX_OUTPUT_TOKENS,
      system: NATURAL_TEXT_CAPTURE_PROMPT.text,
      messages: [{ role: 'user', content: userContent }],
      schema: extractionSchema,
      disableThinking: true,
      effort: 'low',
    });
    if (!result.ok) return { candidates: null, warnings: [result.message] };

    return buildFromAiRows(result.value.transactions);
  }
}

export function buildFromAiRows(
  rows: readonly z.infer<typeof rowSchema>[],
): NaturalTextCaptureResult {
  const warnings: string[] = [];
  const candidates: NaturalTextCandidate[] = [];

  for (const row of rows) {
    let occurredOn: DateOnly;
    try {
      occurredOn = assertDateOnly(row.occurred_on);
    } catch {
      warnings.push(
        `日付を解釈できない取引を1件、読み込みから除きました(${row.store_name || '店名不明'})。`,
      );
      continue;
    }
    const amountYen = Math.round(Math.abs(row.amount_yen));
    if (!Number.isFinite(amountYen) || amountYen === 0 || amountYen > MAX_AMOUNT_YEN) {
      warnings.push(
        `金額を解釈できない取引を1件、読み込みから除きました(${row.store_name || '店名不明'})。`,
      );
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

  if (candidates.length === 0 && rows.length === 0) return { candidates: [], warnings };
  return { candidates, warnings };
}

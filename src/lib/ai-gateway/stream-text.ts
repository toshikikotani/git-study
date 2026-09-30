/**
 * 構造化出力(JSONスキーマ)を使わない、素のテキスト生成をストリーミングで返す
 * (N1本人要件「長い文章はストリーミングで少しずつ表示する」)。
 *
 * parseStructured/parseStructuredGated の zodOutputFormat による構造化出力とは
 * 別の経路——スキーマ検証を伴わないぶん、フィールドごとの正しさは保証されない。
 * 数値を含む長文を作る機能でこれを使う場合は、完成した全文に対して
 * numeric-verification.ts の verifyNumbersAgainstFacts() を別途行うこと。
 */

import type Anthropic from '@anthropic-ai/sdk';

import { DEFAULT_AI_TIMEOUT_MS } from '@/lib/anthropic';

export type StreamTextRequest = {
  client: Anthropic;
  model: string;
  maxTokens: number;
  system: string;
  messages: Anthropic.MessageParam[];
  timeoutMs?: number;
};

export async function* streamText(request: StreamTextRequest): AsyncGenerator<string> {
  const stream = request.client.messages.stream(
    {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages,
    },
    { timeout: request.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS },
  );

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

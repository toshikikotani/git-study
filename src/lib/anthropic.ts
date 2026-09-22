/**
 * Anthropic 呼び出しの共通部分(ADR-033)。
 *
 * 構造化出力を使う機能(レシート・メール・分類・相談・診断・レポート)は
 * どれも「API が失敗した」「max_tokens で切れた」「スキーマに沿わず解釈
 * できなかった」の3つを同じように扱う必要がある。その判断をここだけに置く。
 * 個々の機能が持つのは、渡す内容(model・system・messages・schema)と、
 * 失敗をどう表現するか(warning に積む/例外にする)だけ。
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

export type StructuredFailure = 'api_error' | 'truncated' | 'unparsable';

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type StructuredResult<T> =
  | { ok: true; value: T; usage: TokenUsage }
  /** usage は応答が返ってきた場合(切れた・解釈できない)だけ分かる。 */
  | { ok: false; failure: StructuredFailure; message: string; usage?: TokenUsage };

export type StructuredRequest<S extends z.ZodType> = {
  client: Anthropic;
  model: string;
  maxTokens: number;
  system: string;
  messages: Anthropic.MessageParam[];
  schema: S;
  /** 既定文に足す一言。機能ごとに次の一手が違うため呼び出し側が渡す。 */
  hints?: { truncated?: string; rateLimit?: string };
};

export async function parseStructured<S extends z.ZodType>(
  request: StructuredRequest<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const { client, model, maxTokens, system, messages, schema, hints } = request;

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      output_config: { format: zodOutputFormat(schema) },
    });

    const usage = {
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens,
    };

    if (response.stop_reason === 'max_tokens') {
      return {
        ok: false,
        failure: 'truncated',
        message: `AI の出力が長すぎて途中で切れました。${hints?.truncated ?? ''}`,
        usage,
      };
    }
    if (response.parsed_output === null) {
      return {
        ok: false,
        failure: 'unparsable',
        message: 'AI の返答を解釈できませんでした。',
        usage,
      };
    }

    return { ok: true, value: response.parsed_output, usage };
  } catch (error) {
    return {
      ok: false,
      failure: 'api_error',
      message: describeAnthropicError(error, hints?.rateLimit),
    };
  }
}

/** ANTHROPIC_API_KEY 未設定を本人に伝える言葉。機能名だけ呼び出し側が渡す。 */
export function apiKeyMissingMessage(feature: string): string {
  return `${feature}は設定されていません(ANTHROPIC_API_KEY が未設定)。`;
}

/** API の失敗を本人に見える言葉にする。 */
export function describeAnthropicError(error: unknown, rateLimitHint?: string): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'AI の API キーが無効です。ANTHROPIC_API_KEY を確認してください。';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return `AI の利用上限に達しました。${rateLimitHint ?? 'しばらくしてから再試行してください。'}`;
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `AI への要求が受け付けられませんでした: ${error.message}`;
  }
  if (error instanceof Anthropic.APIError) {
    return `AI の呼び出しに失敗しました(${error.status}): ${error.message}`;
  }
  return `AI の呼び出しに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
}

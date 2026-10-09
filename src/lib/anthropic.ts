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

/** 個々の Anthropic 呼び出しの既定タイムアウト(N1本人要件「タイムアウトは10秒」)。 */
export const DEFAULT_AI_TIMEOUT_MS = 10_000;

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
  /**
   * Sonnet 5 は thinking を指定しないと常に適応的に考え(effort 既定 high)、その分も
   * max_tokens に数えられる——短い構造化出力でも遅くなり、答えを書く前に上限で切れる。
   * 判断が軽い呼び出しでは disableThinking と低い effort で抑える(Haiku 4.5 は
   * effort 非対応のため渡さない)。
   */
  disableThinking?: boolean;
  effort?: 'low' | 'medium' | 'high';
  /** 既定 DEFAULT_AI_TIMEOUT_MS(10秒、N1本人要件)。長いレポート生成等は明示的に伸ばす。 */
  timeoutMs?: number;
};

export async function parseStructured<S extends z.ZodType>(
  request: StructuredRequest<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const {
    client,
    model,
    maxTokens,
    system,
    messages,
    schema,
    hints,
    disableThinking,
    effort,
    timeoutMs,
  } = request;

  try {
    const response = await client.messages.parse(
      {
        model,
        max_tokens: maxTokens,
        system,
        messages,
        ...(disableThinking ? { thinking: { type: 'disabled' as const } } : {}),
        output_config: {
          format: zodOutputFormat(schema),
          ...(effort ? { effort } : {}),
        },
      },
      { timeout: timeoutMs ?? DEFAULT_AI_TIMEOUT_MS },
    );

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
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return 'AI の応答がタイムアウトしました。もう一度お試しください。';
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return 'AI の API キーが無効です。ANTHROPIC_API_KEY を確認してください。';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return `AI の利用上限に達しました。${rateLimitHint ?? 'しばらくしてから再試行してください。'}`;
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    (error instanceof Error && error.message.includes('Unterminated string'))
  ) {
    return 'AI の文章が途中で切れたので、もう一度お試しください。';
  }
  if (error instanceof Anthropic.APIError) {
    return `AI の呼び出しに失敗しました(${error.status}): ${error.message}`;
  }
  return `AI の呼び出しに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * AIチャットでDBを操作する機能(ADR-024の「ルールをAIに相談する」、
 * ADR-054の「AIに変更を頼む」で汎用化)に共通する、ドメインに依らない部分。
 *
 * 会話履歴の検証はどのチャット機能でも同じ形になるため、ここへ集約する
 * (ADR-033、同じ考慮を2回しない)。DBにもネットワークにも触れない。
 */

import { AppError } from '@/lib/errors';

export class ChatToolError extends AppError {}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** 1通あたりの上限。長文を丸ごと送りつけられても費用が跳ねないようにする。 */
export const MAX_MESSAGE_CHARS = 2000;
/** 送り返す履歴の上限(直近分だけを見る。古い文脈は捨ててよい)。 */
export const MAX_HISTORY_MESSAGES = 20;

/**
 * リクエストボディの `messages` を検証する。
 * 形が不正なら null(呼び出し側が 400 を返す)。
 */
export function parseChatMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: ChatMessage[] = [];
  for (const item of value.slice(-MAX_HISTORY_MESSAGES)) {
    if (typeof item !== 'object' || item === null) return null;
    const role = (item as Record<string, unknown>).role;
    const content = (item as Record<string, unknown>).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    messages.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }
  return messages;
}

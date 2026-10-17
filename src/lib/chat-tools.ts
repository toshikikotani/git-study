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

/**
 * モデルへ渡せる会話の形にそろえる(ADR-105)。空の発言を捨て、同じ側が続いたら1つにまとめ、
 * 先頭がAIの発言なら捨てる(履歴を直近分で切ると、AIの発言から始まることがある)。
 * 送れなかった発言のあとに続けて送ると「本人・本人」と並ぶので、まとめて1つの発言にする。
 */
export function toAlternatingTurns(messages: readonly ChatMessage[]): ChatMessage[] {
  const turns: ChatMessage[] = [];
  for (const m of messages) {
    const content = m.content.trim();
    if (content === '') continue;
    const last = turns.at(-1);
    if (last?.role === m.role) {
      last.content = `${last.content}\n${content}`;
    } else if (turns.length > 0 || m.role === 'user') {
      turns.push({ role: m.role, content });
    }
  }
  return turns;
}

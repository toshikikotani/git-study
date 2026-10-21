import { NextResponse } from 'next/server';

import { runAssistantTurn } from '@/features/assistant/turn';
import { parseChatMessages, toAlternatingTurns } from '@/lib/chat-tools';

/**
 * AIの窓口(本人発案、ADR-054 → ADR-059 で唯一の窓口に統合)。会話を受け取り、1回のやり取りを
 * features/assistant/turn.ts に任せる(LINE の会話も同じものを使う、ADR-130)。モデルのツール呼び出しは
 * ここでは実行せず、検証を通した変更案として返すだけ——実際の反映は、本人がチャット内の確認カードで
 * 承認したあとに app/api/assistant/apply/route.ts が行う。
 */

export const runtime = 'nodejs';

export type { AssistantReply } from '@/features/assistant/turn';

export async function POST(request: Request): Promise<NextResponse> {
  let payload: { messages?: unknown };
  try {
    payload = (await request.json()) as { messages?: unknown };
  } catch {
    return NextResponse.json({ error: 'JSON として読めませんでした' }, { status: 400 });
  }

  const parsed = parseChatMessages(payload.messages);
  if (parsed === null) {
    return NextResponse.json({ error: '会話の形式が正しくありません' }, { status: 400 });
  }
  const messages = toAlternatingTurns(parsed);
  if (messages.length === 0) {
    return NextResponse.json({ error: 'メッセージがありません' }, { status: 400 });
  }

  const result = await runAssistantTurn(messages);
  return result.ok
    ? NextResponse.json(result.reply)
    : NextResponse.json({ error: result.error }, { status: result.status });
}

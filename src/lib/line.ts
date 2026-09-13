/**
 * LINE Messaging API(Push Message)への送信。
 *
 * `lib/discord.ts` と同じ役割分担:ここは LINE という外部サービスの
 * クライアントに徹する(何を送るか、どう組み立てるかの業務判断は
 * features/alerts/notify.ts・features/briefs/notify.ts が担う)。
 *
 * LINE の Push Message はテキストのみ(Discord の Embed のような
 * タイトル/本文/色の構造化は無い)。severity の色分けは呼び出し側が
 * 文字(絵文字)で表現する。
 */

const LINE_PUSH_MESSAGE_URL = 'https://api.line.me/v2/bot/message/push';

export class LineSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineSendError';
  }
}

/** 指定した userId(本人の LINE アカウント)へテキストを1件送信する。 */
export async function postLineMessage(
  channelAccessToken: string,
  userId: string,
  text: string,
): Promise<void> {
  const response = await fetch(LINE_PUSH_MESSAGE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new LineSendError(
      `LINE への送信に失敗しました(ステータス ${response.status}): ${detail}`,
    );
  }
}

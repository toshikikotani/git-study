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
  return postLineMessages(channelAccessToken, userId, [{ type: 'text', text }]);
}

/**
 * テキストの直後に画像を1枚添えて送る(本人発案)。LINE は Discord の
 * Embed のような「1メッセージに文字と画像をまとめる」形を持たないため、
 * 同じ push リクエストの中で2件のメッセージとして送る(相手には連続した
 * 2通として届くが、送信自体は1回で済む)。
 *
 * imageUrl は QuickChart 等で作った画像そのものの URL、
 * previewUrl は一覧でのサムネイル用(無ければ imageUrl を使い回す)。
 * LINE 側の制約で両方 https 必須。
 */
export async function postLineTextWithImage(
  channelAccessToken: string,
  userId: string,
  text: string,
  imageUrl: string,
  previewUrl: string = imageUrl,
): Promise<void> {
  return postLineMessages(channelAccessToken, userId, [
    { type: 'text', text },
    { type: 'image', originalContentUrl: imageUrl, previewImageUrl: previewUrl },
  ]);
}

type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; originalContentUrl: string; previewImageUrl: string };

async function postLineMessages(
  channelAccessToken: string,
  userId: string,
  messages: readonly LineMessage[],
): Promise<void> {
  const response = await fetch(LINE_PUSH_MESSAGE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new LineSendError(
      `LINE への送信に失敗しました(ステータス ${response.status}): ${detail}`,
    );
  }
}

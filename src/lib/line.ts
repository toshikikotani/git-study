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

import { AppError } from '@/lib/errors';

const LINE_PUSH_MESSAGE_URL = 'https://api.line.me/v2/bot/message/push';
/** メッセージに添付されたファイル本体を取得するAPI(画像・音声等、ホストが別)。 */
const LINE_CONTENT_API_BASE = 'https://api-data.line.me/v2/bot/message';

export class LineSendError extends AppError {}

/**
 * 受信した画像メッセージの中身を取得する(レシート画像の自動取り込み、本人発案)。
 * LINEは受信画像を常にJPEGへ変換して配信するため、mediaTypeは固定でよい
 * (`/transactions/receipt` の撮影画面がJPEGへリサイズしているのと同じ前提)。
 */
export async function fetchLineImageAsBase64(
  channelAccessToken: string,
  messageId: string,
): Promise<string> {
  const response = await fetch(`${LINE_CONTENT_API_BASE}/${messageId}/content`, {
    headers: { authorization: `Bearer ${channelAccessToken}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new LineSendError(
      `LINE からの画像取得に失敗しました(ステータス ${response.status}): ${detail}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.toString('base64');
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

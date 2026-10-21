/**
 * LINE Messaging API(Push Message・Reply Message)への送信。
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
/** 受け取ったメッセージへの返事(返信トークンは受け取ってから1分ほどだけ使える、無料の枠を使わない)。 */
const LINE_REPLY_MESSAGE_URL = 'https://api.line.me/v2/bot/message/reply';
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

/**
 * メッセージの下に並ぶボタン(クイックリプライ、v4-2、ADR-130)。押すと、ポストバック(data を Webhook に
 * 返す。画面には label を出す)か、URL を開く。1通に13個まで、label は20文字まで(LINE の制約)。
 */
export type LineQuickReplyButton =
  | { kind: 'postback'; label: string; data: string; displayText?: string }
  | { kind: 'uri'; label: string; uri: string };

export const MAX_QUICK_REPLY = 13;
export const MAX_QUICK_REPLY_LABEL = 20;
/** ポストバックの data の上限(LINE の制約)。 */
export const MAX_POSTBACK_DATA = 300;

export type LineMessage =
  | { type: 'text'; text: string; quickReply?: { items: LineQuickReplyItem[] } }
  | { type: 'image'; originalContentUrl: string; previewImageUrl: string };

type LineQuickReplyItem = {
  type: 'action';
  action:
    | { type: 'postback'; label: string; data: string; displayText?: string }
    | { type: 'uri'; label: string; uri: string };
};

/** テキスト1通(ボタンがあれば下に並べる)。LINE の文字数の上限(5000字)で切る。 */
export function lineText(text: string, buttons: readonly LineQuickReplyButton[] = []): LineMessage {
  const items: LineQuickReplyItem[] = buttons.slice(0, MAX_QUICK_REPLY).map((b) => ({
    type: 'action',
    action:
      b.kind === 'postback'
        ? {
            type: 'postback',
            label: b.label.slice(0, MAX_QUICK_REPLY_LABEL),
            data: b.data.slice(0, MAX_POSTBACK_DATA),
            ...(b.displayText ? { displayText: b.displayText.slice(0, 300) } : {}),
          }
        : { type: 'uri', label: b.label.slice(0, MAX_QUICK_REPLY_LABEL), uri: b.uri },
  }));
  return {
    type: 'text',
    text: text.slice(0, 5000),
    ...(items.length > 0 ? { quickReply: { items } } : {}),
  };
}

/** 受け取ったメッセージ・ボタンに返事をする(最大5通)。 */
export async function replyLineMessages(
  channelAccessToken: string,
  replyToken: string,
  messages: readonly LineMessage[],
): Promise<void> {
  await sendLine(LINE_REPLY_MESSAGE_URL, channelAccessToken, {
    replyToken,
    messages: messages.slice(0, 5),
  });
}

/** 本人へプッシュで送る(夜の答え合わせなど、こちらから送るとき)。 */
export async function pushLineMessages(
  channelAccessToken: string,
  userId: string,
  messages: readonly LineMessage[],
): Promise<void> {
  return postLineMessages(channelAccessToken, userId, messages);
}

async function postLineMessages(
  channelAccessToken: string,
  userId: string,
  messages: readonly LineMessage[],
): Promise<void> {
  await sendLine(LINE_PUSH_MESSAGE_URL, channelAccessToken, { to: userId, messages });
}

async function sendLine(url: string, channelAccessToken: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new LineSendError(
      `LINE への送信に失敗しました(ステータス ${response.status}): ${detail}`,
    );
  }
}

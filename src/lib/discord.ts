/**
 * Discord Webhook への送信(FR-24, M3-1)。
 *
 * ここは Discord という外部サービスのクライアントに徹する(何を送るか、
 * どう組み立てるかの業務判断は features/alerts/notify.ts が担う)。
 */

import { AppError } from '@/lib/errors';

export type DiscordEmbed = {
  title: string;
  description?: string | undefined;
  color: number;
  /** QuickChart 等で作った画像URL(本人発案)。Embed にそのまま貼れる。 */
  imageUrl?: string | undefined;
};

export class DiscordSendError extends AppError {}

/** Webhook へ Embed を1件送信する。 */
export async function postDiscordEmbed(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  const { imageUrl, ...rest } = embed;
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      embeds: [{ ...rest, image: imageUrl ? { url: imageUrl } : undefined }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new DiscordSendError(
      `Discord への送信に失敗しました(ステータス ${response.status}): ${detail}`,
    );
  }
}

/**
 * Discord Webhook への送信(FR-24, M3-1)。
 *
 * ここは Discord という外部サービスのクライアントに徹する(何を送るか、
 * どう組み立てるかの業務判断は features/alerts/notify.ts が担う)。
 */

export type DiscordEmbed = {
  title: string;
  description?: string | undefined;
  color: number;
};

export class DiscordSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordSendError';
  }
}

/** Webhook へ Embed を1件送信する。 */
export async function postDiscordEmbed(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new DiscordSendError(
      `Discord への送信に失敗しました(ステータス ${response.status}): ${detail}`,
    );
  }
}

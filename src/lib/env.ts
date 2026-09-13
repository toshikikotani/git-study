/**
 * 環境変数の検証(ADR-014, NFR-04)。
 *
 * 設定漏れはデプロイ後の実行時ではなく、起動直後に落とす。
 * 秘密情報は環境変数にのみ置き、DB にもリポジトリにも入れない。
 *
 * クライアントへ渡ってよいのは NEXT_PUBLIC_ 接頭辞のものだけ。
 * serverEnv は 'server-only' 経由でのみ読めるようにしてある。
 */

import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: 'Supabase の URL を設定してください' }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, 'Supabase の anon キーが短すぎます'),
});

/**
 * サーバー専用の秘密情報は、機能ごとに独立した関数で取り出す
 * (1つの必須スキーマにまとめない)。
 *
 * まとめてしまうと、CRON_SECRET だけを使いたい呼び出し元が、
 * まだ設定していない DISCORD_WEBHOOK_URL や ANTHROPIC_API_KEY の
 * 欠落でも巻き添えでエラーになる。機能ごとに使うときだけ検証する
 * (features/import/email/route.ts の ANTHROPIC_API_KEY・
 * features/settings/gmail の GMAIL_* と同じ考え方)。
 */
const cronSecretSchema = z.string().min(32, 'CRON_SECRET は 32 文字以上にしてください');
const supabaseServiceRoleKeySchema = z.string().min(20, 'service_role キーが短すぎます');
const anthropicApiKeySchema = z
  .string()
  .startsWith('sk-ant-', 'Anthropic の API キー形式ではありません');
const discordWebhookUrlSchema = z
  .url()
  .refine((v) => v.startsWith('https://discord.com/api/webhooks/'), {
    error: 'Discord の Webhook URL ではありません',
  });

/**
 * Gmail 自動取得(ADR-018)。未設定でもアプリは動く。
 * 設定されていれば取り込みジョブが有効になる。
 *
 * アプリパスワードは 16 文字。通常の Gmail パスワードでは接続できない
 * (Google は 2025年5月に通常パスワードでの third-party アクセスを停止)。
 */
const gmailSchema = z.object({
  GMAIL_ADDRESS: z.email({ error: 'Gmail のアドレスを設定してください' }),
  GMAIL_APP_PASSWORD: z
    .string()
    .transform((v) => v.replace(/\s/g, ''))
    .refine((v) => v.length === 16, {
      error: 'アプリパスワードは16文字です。通常のパスワードでは接続できません',
    }),
});

/**
 * LINE Messaging API(通知・朝配信の送信先の1つ、Discord と並ぶ選択肢)。
 * 未設定でもアプリは動く(Gmail と同じ考え方)。
 *
 * userId は LINE Developers コンソールの Webhook で本人が Bot に送った
 * メッセージから拾う値('U' + 32桁の16進数、33文字固定)。
 */
const lineSchema = z.object({
  LINE_CHANNEL_ACCESS_TOKEN: z
    .string()
    .min(50, 'LINE のチャネルアクセストークンの形式ではありません'),
  LINE_USER_ID: z
    .string()
    .regex(/^U[0-9a-f]{32}$/, 'LINE の userId の形式(U+32桁の16進数)ではありません'),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type GmailEnv = z.infer<typeof gmailSchema>;
export type LineEnv = z.infer<typeof lineSchema>;

/**
 * 通知の送信先チャネル。Discord・LINE のどちらか、または両方が設定されうる
 * (features/alerts/notify.ts・features/briefs/notify.ts の両方が使う共通の形)。
 */
export type NotificationChannels = {
  discordWebhookUrl: string | null;
  line: LineEnv | null;
};

function parseOrThrow<T extends z.ZodType>(schema: T, source: unknown, label: string): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) =>
        issue.path.length > 0
          ? `  - ${issue.path.join('.')}: ${issue.message}`
          : `  - ${issue.message}`,
      )
      .join('\n');
    throw new Error(
      `${label}の設定に問題があります。\n${details}\n\n.env.example を参照してください。`,
    );
  }
  return result.data;
}

/**
 * クライアントでも読める設定。
 * Next.js は NEXT_PUBLIC_* をビルド時に埋め込むため、process.env から
 * 個別に取り出す(分割代入やスプレッドでは置換されない)。
 */
export function getPublicEnv(): PublicEnv {
  return parseOrThrow(
    publicSchema,
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    '公開環境変数',
  );
}

/** RLS を越える。サーバー側でのみ使う。絶対にクライアントへ渡さない。 */
export function getSupabaseServiceRoleKey(): string {
  return parseOrThrow(
    supabaseServiceRoleKeySchema,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    'SUPABASE_SERVICE_ROLE_KEY',
  );
}

/** /api/cron/* の認証(ADR-009)。 */
export function getCronSecret(): string {
  return parseOrThrow(cronSecretSchema, process.env.CRON_SECRET, 'CRON_SECRET');
}

/** 明細分類・朝配信の生成(ADR-010)。 */
export function getAnthropicApiKey(): string {
  return parseOrThrow(anthropicApiKeySchema, process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY');
}

/** 通知・朝配信の送信先(ADR-002)。 */
export function getDiscordWebhookUrl(): string {
  return parseOrThrow(
    discordWebhookUrlSchema,
    process.env.DISCORD_WEBHOOK_URL,
    'DISCORD_WEBHOOK_URL',
  );
}

/**
 * Discord Webhook URL。未設定なら null を返す(B-3 待ちのあいだ、
 * アラートジョブ自体は落とさずスキップできるようにする。GMAIL_ADDRESS 等
 * の getGmailEnv() と同じ考え方)。
 */
export function getOptionalDiscordWebhookUrl(): string | null {
  const value = process.env.DISCORD_WEBHOOK_URL;
  if (!value) return null;
  return parseOrThrow(discordWebhookUrlSchema, value, 'DISCORD_WEBHOOK_URL');
}

/**
 * Gmail の資格情報。未設定なら null を返す(機能が無効なだけで、エラーではない)。
 * 中途半端に片方だけ設定されている場合は、黙って無効化せずエラーにする。
 */
export function getGmailEnv(): GmailEnv | null {
  const address = process.env.GMAIL_ADDRESS;
  const password = process.env.GMAIL_APP_PASSWORD;

  if (!address && !password) return null;

  return parseOrThrow(
    gmailSchema,
    { GMAIL_ADDRESS: address, GMAIL_APP_PASSWORD: password },
    'Gmail 連携の設定',
  );
}

/**
 * LINE の資格情報。未設定なら null を返す(Discord Webhook と同じ「あれば使う」
 * 設計。Gmail と同じく片方だけの設定はエラーにする)。
 */
export function getLineEnv(): LineEnv | null {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!token && !userId) return null;

  return parseOrThrow(
    lineSchema,
    { LINE_CHANNEL_ACCESS_TOKEN: token, LINE_USER_ID: userId },
    'LINE 連携の設定',
  );
}

/**
 * Gmail 取り込み先の口座 ID(M2-7c)。
 *
 * accounts テーブルへの外部キーだが、DB(app_settings)には持たせない。
 * 本アプリはシングルユーザーで、この値を画面から編集する UI を持つ意味が
 * 薄い一方、環境変数に置けば GMAIL_ADDRESS / GMAIL_APP_PASSWORD と同じ経路
 * (Vercel の環境変数 + GitHub Secrets)だけで設定が完結する(ADR-018 と同じ考え方)。
 * 未設定なら null(Gmail 連携自体が無効なのと同様、機能が動かないだけ)。
 */
export function getGmailImportAccountId(): string | null {
  const value = process.env.GMAIL_IMPORT_ACCOUNT_ID;
  if (!value) return null;
  return parseOrThrow(
    z.uuid({ error: 'accounts.id の形式(uuid)ではありません' }),
    value,
    'GMAIL_IMPORT_ACCOUNT_ID',
  );
}

/** テスト用に schema を公開する。実行時の検証には各 get*Env / get*Secret 関数を使う。 */
export const schemas = {
  publicSchema,
  cronSecretSchema,
  supabaseServiceRoleKeySchema,
  anthropicApiKeySchema,
  discordWebhookUrlSchema,
  gmailSchema,
  lineSchema,
};

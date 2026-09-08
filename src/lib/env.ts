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

const serverSchema = z.object({
  /** RLS を越える。サーバー側でのみ使う。絶対にクライアントへ渡さない。 */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'service_role キーが短すぎます'),
  /** 明細分類・朝配信の生成(ADR-010)。 */
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-', 'Anthropic の API キー形式ではありません'),
  /** 通知・朝配信の送信先(ADR-002)。 */
  DISCORD_WEBHOOK_URL: z.url().refine((v) => v.startsWith('https://discord.com/api/webhooks/'), {
    error: 'Discord の Webhook URL ではありません',
  }),
  /** /api/cron/* の認証(ADR-009)。 */
  CRON_SECRET: z.string().min(32, 'CRON_SECRET は 32 文字以上にしてください'),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function parseOrThrow<T extends z.ZodType>(schema: T, source: unknown, label: string): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
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

/** サーバー専用の設定。Route Handler / Server Action / ジョブからのみ呼ぶ。 */
export function getServerEnv(): ServerEnv {
  return parseOrThrow(
    serverSchema,
    {
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
      CRON_SECRET: process.env.CRON_SECRET,
    },
    'サーバー環境変数',
  );
}

/** テスト用に schema を公開する。実行時の検証には getPublicEnv / getServerEnv を使う。 */
export const schemas = { publicSchema, serverSchema };

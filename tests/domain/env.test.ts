import { describe, expect, it } from 'vitest';

import { schemas } from '@/lib/env';

/**
 * 環境変数の検証(ADR-014)。設定漏れや誤った値を、実行時ではなく起動直後に落とす。
 * ここで守りたいのは「秘密情報の形式が違うまま本番が動き出す」ことを防ぐこと。
 */

const validPublic = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
};

describe('publicSchema', () => {
  it('正しい値を通す', () => {
    expect(schemas.publicSchema.safeParse(validPublic).success).toBe(true);
  });

  it('URL でない Supabase URL を拒否する', () => {
    const result = schemas.publicSchema.safeParse({
      ...validPublic,
      NEXT_PUBLIC_SUPABASE_URL: 'abcdefghijkl.supabase.co',
    });
    expect(result.success).toBe(false);
  });

  it.each(Object.keys(validPublic))('%s が欠けていると失敗する', (key) => {
    const source: Record<string, unknown> = { ...validPublic };
    delete source[key];
    expect(schemas.publicSchema.safeParse(source).success).toBe(false);
  });
});

/**
 * サーバー専用の秘密情報は、機能ごとに独立したスキーマで検証する
 * (CRON_SECRET だけを使いたい呼び出し元が、まだ設定していない
 * DISCORD_WEBHOOK_URL や ANTHROPIC_API_KEY の欠落で巻き添えにならないように)。
 */
describe('supabaseServiceRoleKeySchema', () => {
  it('正しい値を通す', () => {
    expect(schemas.supabaseServiceRoleKeySchema.safeParse('b'.repeat(40)).success).toBe(true);
  });

  it('短すぎる service_role キーを拒否する', () => {
    expect(schemas.supabaseServiceRoleKeySchema.safeParse('short').success).toBe(false);
  });
});

describe('cronSecretSchema', () => {
  it('正しい値を通す', () => {
    expect(schemas.cronSecretSchema.safeParse('c'.repeat(32)).success).toBe(true);
  });

  it('短すぎる CRON_SECRET を拒否する', () => {
    expect(schemas.cronSecretSchema.safeParse('short').success).toBe(false);
  });
});

describe('anthropicApiKeySchema', () => {
  it('正しい値を通す', () => {
    expect(schemas.anthropicApiKeySchema.safeParse('sk-ant-api03-xxxxxxxx').success).toBe(true);
  });

  it('Anthropic の API キー形式でないものを拒否する', () => {
    expect(schemas.anthropicApiKeySchema.safeParse('not-an-anthropic-key').success).toBe(false);
  });
});

describe('discordWebhookUrlSchema', () => {
  it('正しい値を通す', () => {
    expect(
      schemas.discordWebhookUrlSchema.safeParse('https://discord.com/api/webhooks/123/abc').success,
    ).toBe(true);
  });

  it('Discord 以外の Webhook URL を拒否する(誤送信先を防ぐ)', () => {
    expect(
      schemas.discordWebhookUrlSchema.safeParse('https://example.com/api/webhooks/123/abc').success,
    ).toBe(false);
  });
});

describe('lineSchema(LINE連携)', () => {
  const valid = {
    LINE_CHANNEL_ACCESS_TOKEN: 'a'.repeat(80),
    LINE_USER_ID: `U${'0123456789abcdef'.repeat(2)}`,
  };

  it('正しい値を通す', () => {
    expect(schemas.lineSchema.safeParse(valid).success).toBe(true);
  });

  it('短すぎるチャネルアクセストークンを拒否する', () => {
    expect(
      schemas.lineSchema.safeParse({ ...valid, LINE_CHANNEL_ACCESS_TOKEN: 'short' }).success,
    ).toBe(false);
  });

  it('U+32桁の16進数でない userId を拒否する', () => {
    expect(
      schemas.lineSchema.safeParse({ ...valid, LINE_USER_ID: 'not-a-line-user-id' }).success,
    ).toBe(false);
  });
});

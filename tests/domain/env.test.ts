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

const validServer = {
  SUPABASE_SERVICE_ROLE_KEY: 'b'.repeat(40),
  ANTHROPIC_API_KEY: 'sk-ant-api03-xxxxxxxx',
  DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
  CRON_SECRET: 'c'.repeat(32),
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

describe('serverSchema', () => {
  it('正しい値を通す', () => {
    expect(schemas.serverSchema.safeParse(validServer).success).toBe(true);
  });

  it.each(Object.keys(validServer))('%s が欠けていると失敗する', (key) => {
    const source: Record<string, unknown> = { ...validServer };
    delete source[key];
    expect(schemas.serverSchema.safeParse(source).success).toBe(false);
  });

  it('Anthropic の API キー形式でないものを拒否する', () => {
    const result = schemas.serverSchema.safeParse({
      ...validServer,
      ANTHROPIC_API_KEY: 'not-an-anthropic-key',
    });
    expect(result.success).toBe(false);
  });

  it('Discord 以外の Webhook URL を拒否する(誤送信先を防ぐ)', () => {
    const result = schemas.serverSchema.safeParse({
      ...validServer,
      DISCORD_WEBHOOK_URL: 'https://example.com/api/webhooks/123/abc',
    });
    expect(result.success).toBe(false);
  });

  it('短すぎる CRON_SECRET を拒否する', () => {
    const result = schemas.serverSchema.safeParse({ ...validServer, CRON_SECRET: 'short' });
    expect(result.success).toBe(false);
  });
});

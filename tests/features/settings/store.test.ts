import { describe, expect, it } from 'vitest';

import { chain, type MockResult } from '../../helpers/supabase-mock';
import { getAppSettingsAsAdmin } from '@/features/settings/store';

/**
 * ai_enabled 列が本番にまだ適用されていない(マイグレーション未適用)ときに、
 * 設定の読み取りが画面全体を落とさず動き続けることを確認する回帰テスト。
 * 直接の原因:マージ後に /plan・/debts・/investments・/side-hustle・
 * /settings/ai など getAppSettings() を呼ぶ画面が軒並み動かなくなった不具合
 * (isMissingColumnError の握り潰しが無かった)。
 */
function fakeClient(select: () => MockResult) {
  return {
    from: (table: string) => {
      if (table !== 'app_settings') throw new Error(`unexpected table: ${table}`);
      return chain(select());
    },
  } as unknown as Parameters<typeof getAppSettingsAsAdmin>[0];
}

const rowWithAiEnabled = {
  monthly_repayment_target_yen: 30000,
  repayment_strategy: 'balanced',
  investment_ratio_of_repayment: 0.2,
  is_high_risk_unlocked: false,
  high_risk_allocation_ratio: 0.3,
  payday: 25,
  side_income_repayment_ratio: 0.7,
  ai_enabled: false,
};

const rowWithoutAiEnabled = {
  monthly_repayment_target_yen: 30000,
  repayment_strategy: 'balanced',
  investment_ratio_of_repayment: 0.2,
  is_high_risk_unlocked: false,
  high_risk_allocation_ratio: 0.3,
  payday: 25,
  side_income_repayment_ratio: 0.7,
};

describe('getAppSettingsAsAdmin', () => {
  it('列がすべて揃っていれば、そのまま返す', async () => {
    const client = fakeClient(() => ({ data: rowWithAiEnabled, error: null }));
    const settings = await getAppSettingsAsAdmin(client, 'u1');
    expect(settings.aiEnabled).toBe(false);
    expect(settings.payday).toBe(25);
  });

  it('ai_enabled 列が未適用(42703)でも、列を外して再取得し落ちない(既定はAI有効)', async () => {
    let call = 0;
    const client = fakeClient(() => {
      call += 1;
      if (call === 1) return { data: null, error: { code: '42703', message: 'column missing' } };
      return { data: rowWithoutAiEnabled, error: null };
    });
    const settings = await getAppSettingsAsAdmin(client, 'u1');
    expect(settings.aiEnabled).toBe(true);
    expect(settings.payday).toBe(25);
  });

  it('ai_enabled 列が未適用(PGRST204)でも同様に落ちない', async () => {
    let call = 0;
    const client = fakeClient(() => {
      call += 1;
      if (call === 1)
        return { data: null, error: { code: 'PGRST204', message: 'schema cache miss' } };
      return { data: rowWithoutAiEnabled, error: null };
    });
    const settings = await getAppSettingsAsAdmin(client, 'u1');
    expect(settings.aiEnabled).toBe(true);
  });

  it('無関係のエラーはそのまま投げる(握り潰さない)', async () => {
    const client = fakeClient(() => ({
      data: null,
      error: { code: 'PGRST301', message: 'network' },
    }));
    await expect(getAppSettingsAsAdmin(client, 'u1')).rejects.toThrow();
  });
});

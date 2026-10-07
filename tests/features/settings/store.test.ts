import { describe, expect, it } from 'vitest';

import { chain, type MockResult } from '../../helpers/supabase-mock';
import { getAppSettingsAsAdmin } from '@/features/settings/store';

/**
 * 列が本番にまだ適用されていない(ai_enabled、ADR-077 の貯金への改名)ときに、
 * 設定の読み取りが画面全体を落とさず動き続けることを確認する回帰テスト。
 * 直接の原因:マージ後に /plan・/investments・/side-hustle・
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

const savingsRow = {
  monthly_savings_target_yen: 30000,
  investment_ratio_of_savings: 0.2,
  is_high_risk_unlocked: false,
  high_risk_allocation_ratio: 0.3,
  payday: 25,
  side_income_savings_ratio: 0.7,
  ai_enabled: false,
};

/** 貯金への改名(ADR-077)も ai_enabled も未適用の本番の行。 */
const legacyRow = {
  monthly_repayment_target_yen: 40000,
  repayment_strategy: 'avalanche',
  investment_ratio_of_repayment: 0.25,
  is_high_risk_unlocked: true,
  high_risk_allocation_ratio: 0.3,
  payday: 20,
  side_income_repayment_ratio: 0.6,
};

describe('getAppSettingsAsAdmin', () => {
  it('列がすべて揃っていれば、そのまま返す', async () => {
    const client = fakeClient(() => ({ data: savingsRow, error: null }));
    const settings = await getAppSettingsAsAdmin(client, 'u1');
    expect(settings).toEqual({
      monthlySavingsTargetYen: 30000,
      investmentRatioOfSavings: 0.2,
      isHighRiskUnlocked: false,
      highRiskAllocationRatio: 0.3,
      payday: 25,
      sideIncomeSavingsRatio: 0.7,
      aiEnabled: false,
    });
  });

  it('改名前の列名・ai_enabled の無い行でも落ちずに読む(既定はAI有効)', async () => {
    const client = fakeClient(() => ({ data: legacyRow, error: null }));
    const settings = await getAppSettingsAsAdmin(client, 'u1');
    expect(settings.monthlySavingsTargetYen).toBe(40000);
    expect(settings.investmentRatioOfSavings).toBe(0.25);
    expect(settings.sideIncomeSavingsRatio).toBe(0.6);
    expect(settings.isHighRiskUnlocked).toBe(true);
    expect(settings.payday).toBe(20);
    expect(settings.aiEnabled).toBe(true);
  });

  it('エラーはそのまま投げる(握り潰さない)', async () => {
    const client = fakeClient(() => ({
      data: null,
      error: { code: 'PGRST301', message: 'network' },
    }));
    await expect(getAppSettingsAsAdmin(client, 'u1')).rejects.toThrow();
  });
});

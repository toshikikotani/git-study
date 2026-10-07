import { describe, expect, it } from 'vitest';

import { ChatToolError } from '@/lib/chat-tools';
import { buildSettingsContextLine, parseAppSettingsPatch } from '@/features/settings/chat-tools';
import type { AppSettings } from '@/features/settings/store';

/**
 * 「AIに変更を頼む」の本人設定ドメイン(ADR-054)の純粋な部分。
 * DBにもネットワークにも触れない検証・組み立てだけを試す。
 */

const SETTINGS: AppSettings = {
  monthlySavingsTargetYen: 100000,
  investmentRatioOfSavings: 0.2,
  isHighRiskUnlocked: false,
  highRiskAllocationRatio: 0.3,
  payday: 25,
  sideIncomeSavingsRatio: 0.7,
  aiEnabled: true,
};

describe('parseAppSettingsPatch', () => {
  it('給料日を1〜31の整数として受け付ける', () => {
    const { patch, descriptions } = parseAppSettingsPatch({ payday: 20 });
    expect(patch).toEqual({ payday: 20 });
    expect(descriptions).toEqual(['給料日: 20日']);
  });

  it('給料日が範囲外なら拒む', () => {
    expect(() => parseAppSettingsPatch({ payday: 32 })).toThrow(ChatToolError);
    expect(() => parseAppSettingsPatch({ payday: 0 })).toThrow(ChatToolError);
    expect(() => parseAppSettingsPatch({ payday: 15.5 })).toThrow(ChatToolError);
  });

  it('比率(0〜1)の項目は範囲外を拒む', () => {
    expect(() => parseAppSettingsPatch({ investment_ratio_of_savings: 1.5 })).toThrow(
      ChatToolError,
    );
    expect(() => parseAppSettingsPatch({ high_risk_allocation_ratio: -0.1 })).toThrow(
      ChatToolError,
    );
    expect(parseAppSettingsPatch({ side_income_savings_ratio: 0.5 }).patch).toEqual({
      sideIncomeSavingsRatio: 0.5,
    });
  });

  it('毎月の貯金目標は0以上の整数円のみ受け付ける', () => {
    expect(() => parseAppSettingsPatch({ monthly_savings_target_yen: -1 })).toThrow(ChatToolError);
    expect(() => parseAppSettingsPatch({ monthly_savings_target_yen: 1.5 })).toThrow(ChatToolError);
    expect(parseAppSettingsPatch({ monthly_savings_target_yen: 120000 }).patch).toEqual({
      monthlySavingsTargetYen: 120000,
    });
  });

  it('高リスク投資枠を使うかは真偽値のみ受け付ける', () => {
    expect(() => parseAppSettingsPatch({ is_high_risk_unlocked: 'yes' })).toThrow(ChatToolError);
    expect(parseAppSettingsPatch({ is_high_risk_unlocked: true }).patch).toEqual({
      isHighRiskUnlocked: true,
    });
  });

  it('複数項目を同時に受け付ける', () => {
    const { patch, descriptions } = parseAppSettingsPatch({
      payday: 10,
      monthly_savings_target_yen: 50000,
    });
    expect(patch).toEqual({ payday: 10, monthlySavingsTargetYen: 50000 });
    expect(descriptions).toHaveLength(2);
  });

  it('1項目も無ければ拒む', () => {
    expect(() => parseAppSettingsPatch({})).toThrow(ChatToolError);
    expect(() => parseAppSettingsPatch(null)).toThrow(ChatToolError);
  });
});

describe('buildSettingsContextLine', () => {
  it('現在の設定値を1行に整形する', () => {
    const line = buildSettingsContextLine(SETTINGS);
    expect(line).toContain('給料日=25日');
    expect(line).toContain('毎月の貯金目標=100000円');
    expect(line).toContain('高リスク投資枠=使わない');
  });
});

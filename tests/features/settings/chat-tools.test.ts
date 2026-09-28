import { describe, expect, it } from 'vitest';

import { ChatToolError } from '@/lib/chat-tools';
import { buildSettingsContextLine, parseAppSettingsPatch } from '@/features/settings/chat-tools';
import type { AppSettings } from '@/features/settings/store';

/**
 * 「AIに変更を頼む」の本人設定ドメイン(ADR-054)の純粋な部分。
 * DBにもネットワークにも触れない検証・組み立てだけを試す。
 */

const SETTINGS: AppSettings = {
  monthlyRepaymentTargetYen: 100000,
  repaymentStrategy: 'avalanche',
  investmentRatioOfRepayment: 0.2,
  isHighRiskUnlocked: false,
  highRiskAllocationRatio: 0.3,
  payday: 25,
  sideIncomeRepaymentRatio: 0.7,
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

  it('返済戦略は既定の4種類のみ受け付ける', () => {
    expect(parseAppSettingsPatch({ repayment_strategy: 'snowball' }).patch).toEqual({
      repaymentStrategy: 'snowball',
    });
    expect(() => parseAppSettingsPatch({ repayment_strategy: 'aggressive' })).toThrow(
      ChatToolError,
    );
  });

  it('比率(0〜1)の項目は範囲外を拒む', () => {
    expect(() => parseAppSettingsPatch({ investment_ratio_of_repayment: 1.5 })).toThrow(
      ChatToolError,
    );
    expect(() => parseAppSettingsPatch({ high_risk_allocation_ratio: -0.1 })).toThrow(
      ChatToolError,
    );
    expect(parseAppSettingsPatch({ side_income_repayment_ratio: 0.5 }).patch).toEqual({
      sideIncomeRepaymentRatio: 0.5,
    });
  });

  it('返済目標額は0以上の整数円のみ受け付ける', () => {
    expect(() => parseAppSettingsPatch({ monthly_repayment_target_yen: -1 })).toThrow(
      ChatToolError,
    );
    expect(() => parseAppSettingsPatch({ monthly_repayment_target_yen: 1.5 })).toThrow(
      ChatToolError,
    );
    expect(parseAppSettingsPatch({ monthly_repayment_target_yen: 120000 }).patch).toEqual({
      monthlyRepaymentTargetYen: 120000,
    });
  });

  it('高リスク投資枠の解禁は真偽値のみ受け付ける', () => {
    expect(() => parseAppSettingsPatch({ is_high_risk_unlocked: 'yes' })).toThrow(ChatToolError);
    expect(parseAppSettingsPatch({ is_high_risk_unlocked: true }).patch).toEqual({
      isHighRiskUnlocked: true,
    });
  });

  it('複数項目を同時に受け付ける', () => {
    const { patch, descriptions } = parseAppSettingsPatch({
      payday: 10,
      monthly_repayment_target_yen: 50000,
    });
    expect(patch).toEqual({ payday: 10, monthlyRepaymentTargetYen: 50000 });
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
    expect(line).toContain('返済戦略=avalanche');
    expect(line).toContain('高リスク投資枠=未解禁');
  });
});

/**
 * 「本人設定」を扱うAIチャットツールの純粋な部分(本人発案「AIに変更を頼む」、
 * ADR-054)。DB にもネットワークにも触れない(app/api/assistant/chat/route.ts が
 * 実際の読み書きを担う薄い層になる、features/classification/chat-tools.ts と
 * 同じ構成)。
 *
 * ここで扱えるのは `AppSettings`(業務パラメータ、ADR-014)の列だけ——
 * シークレット(env変数名の参照値)を保持する列はこのテーブルに存在せず、
 * `AppSettingsPatch` の型自体がそれ以外の列を受け付けない。
 */

import type { AppSettings, AppSettingsPatch } from '@/features/settings/store';
import { ChatToolError } from '@/lib/chat-tools';
import { isValidDayOfMonth } from '@/lib/date';

function isRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * update_settings ツールの入力を検証し、DBへ渡すpatchと本人向けの
 * 変更説明(見せる用の短い日本語)を組み立てる。1項目でも不正なら
 * ChatToolError(部分的な適用はしない——本人の指示と食い違う値が
 * 混ざるのを避けるため)。
 */
export function parseAppSettingsPatch(input: unknown): {
  patch: AppSettingsPatch;
  descriptions: string[];
} {
  const args = (input !== null && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >;
  const patch: AppSettingsPatch = {};
  const descriptions: string[] = [];

  if (args.payday !== undefined) {
    const value = Number(args.payday);
    if (!isValidDayOfMonth(value)) {
      throw new ChatToolError('給料日は1〜31の整数で指定してください。');
    }
    patch.payday = value;
    descriptions.push(`給料日: ${value}日`);
  }
  if (args.monthly_savings_target_yen !== undefined) {
    const value = Number(args.monthly_savings_target_yen);
    if (!Number.isInteger(value) || value < 0) {
      throw new ChatToolError('毎月の貯金目標は0以上の整数円で指定してください。');
    }
    patch.monthlySavingsTargetYen = value;
    descriptions.push(`毎月の貯金目標: ${value.toLocaleString('ja-JP')}円`);
  }
  if (args.investment_ratio_of_savings !== undefined) {
    const value = Number(args.investment_ratio_of_savings);
    if (!isRatio(value)) throw new ChatToolError('投資比率は0〜1の数値で指定してください。');
    patch.investmentRatioOfSavings = value;
    descriptions.push(`貯金目標に対する投資比率: ${value}`);
  }
  if (args.is_high_risk_unlocked !== undefined) {
    if (typeof args.is_high_risk_unlocked !== 'boolean') {
      throw new ChatToolError('高リスク投資枠を使うかは true/false で指定してください。');
    }
    patch.isHighRiskUnlocked = args.is_high_risk_unlocked;
    descriptions.push(`高リスク投資枠: ${args.is_high_risk_unlocked ? '使う' : '使わない'}`);
  }
  if (args.high_risk_allocation_ratio !== undefined) {
    const value = Number(args.high_risk_allocation_ratio);
    if (!isRatio(value)) {
      throw new ChatToolError('高リスク投資枠の比率は0〜1の数値で指定してください。');
    }
    patch.highRiskAllocationRatio = value;
    descriptions.push(`高リスク投資枠の比率: ${value}`);
  }
  if (args.side_income_savings_ratio !== undefined) {
    const value = Number(args.side_income_savings_ratio);
    if (!isRatio(value)) {
      throw new ChatToolError('副業収入のうち貯金に回す比率は0〜1の数値で指定してください。');
    }
    patch.sideIncomeSavingsRatio = value;
    descriptions.push(`副業収入の貯金比率: ${value}`);
  }

  if (Object.keys(patch).length === 0) {
    throw new ChatToolError('変更する項目がありません。');
  }
  return { patch, descriptions };
}

/** システムプロンプトに埋め込む、現在の設定値の要約(1行)。 */
export function buildSettingsContextLine(settings: AppSettings): string {
  return [
    `給料日=${settings.payday}日`,
    `毎月の貯金目標=${settings.monthlySavingsTargetYen}円`,
    `貯金目標に対する投資比率=${settings.investmentRatioOfSavings}`,
    `高リスク投資枠=${settings.isHighRiskUnlocked ? '使う' : '使わない'}`,
    `高リスク投資枠の比率=${settings.highRiskAllocationRatio}`,
    `副業収入の貯金比率=${settings.sideIncomeSavingsRatio}`,
  ].join(' / ');
}

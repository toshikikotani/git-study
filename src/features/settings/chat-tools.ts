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

import type { AppSettings, AppSettingsPatch, RepaymentStrategy } from '@/features/settings/store';
import { ChatToolError } from '@/lib/chat-tools';
import { isValidDayOfMonth } from '@/lib/date';

const REPAYMENT_STRATEGIES: readonly RepaymentStrategy[] = [
  'avalanche',
  'snowball',
  'minimum',
  'custom',
];

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
  if (args.monthly_repayment_target_yen !== undefined) {
    const value = Number(args.monthly_repayment_target_yen);
    if (!Number.isInteger(value) || value < 0) {
      throw new ChatToolError('返済目標額は0以上の整数円で指定してください。');
    }
    patch.monthlyRepaymentTargetYen = value;
    descriptions.push(`月々の返済目標額: ${value.toLocaleString('ja-JP')}円`);
  }
  if (args.repayment_strategy !== undefined) {
    const value = args.repayment_strategy;
    if (typeof value !== 'string' || !REPAYMENT_STRATEGIES.includes(value as RepaymentStrategy)) {
      throw new ChatToolError(
        `返済戦略は ${REPAYMENT_STRATEGIES.join('/')} のいずれかで指定してください。`,
      );
    }
    patch.repaymentStrategy = value as RepaymentStrategy;
    descriptions.push(`返済戦略: ${value}`);
  }
  if (args.investment_ratio_of_repayment !== undefined) {
    const value = Number(args.investment_ratio_of_repayment);
    if (!isRatio(value)) throw new ChatToolError('投資比率は0〜1の数値で指定してください。');
    patch.investmentRatioOfRepayment = value;
    descriptions.push(`返済目標額に対する投資比率: ${value}`);
  }
  if (args.is_high_risk_unlocked !== undefined) {
    if (typeof args.is_high_risk_unlocked !== 'boolean') {
      throw new ChatToolError('高リスク投資枠の解禁は true/false で指定してください。');
    }
    patch.isHighRiskUnlocked = args.is_high_risk_unlocked;
    descriptions.push(`高リスク投資枠: ${args.is_high_risk_unlocked ? '解禁' : '未解禁'}`);
  }
  if (args.high_risk_allocation_ratio !== undefined) {
    const value = Number(args.high_risk_allocation_ratio);
    if (!isRatio(value)) {
      throw new ChatToolError('高リスク投資枠の比率は0〜1の数値で指定してください。');
    }
    patch.highRiskAllocationRatio = value;
    descriptions.push(`高リスク投資枠の比率: ${value}`);
  }
  if (args.side_income_repayment_ratio !== undefined) {
    const value = Number(args.side_income_repayment_ratio);
    if (!isRatio(value)) {
      throw new ChatToolError('副業収入のうち返済に回す比率は0〜1の数値で指定してください。');
    }
    patch.sideIncomeRepaymentRatio = value;
    descriptions.push(`副業収入の返済比率: ${value}`);
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
    `月々の返済目標額=${settings.monthlyRepaymentTargetYen}円`,
    `返済戦略=${settings.repaymentStrategy}`,
    `返済目標額に対する投資比率=${settings.investmentRatioOfRepayment}`,
    `高リスク投資枠=${settings.isHighRiskUnlocked ? '解禁' : '未解禁'}`,
    `高リスク投資枠の比率=${settings.highRiskAllocationRatio}`,
    `副業収入の返済比率=${settings.sideIncomeRepaymentRatio}`,
  ].join(' / ');
}

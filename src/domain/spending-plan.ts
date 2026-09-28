/**
 * 期間つきの支出目標(本人発案、ADR-058)の純粋な判断。DBにもネットワークにも
 * 触れない。AIには「どのジャンルを、なぜ、どれだけ削るか」の判断だけを任せ、
 * 削る幅の上限(徐々に改善する歯止め)・必須支出は削らない・目標を
 * 過去実績より増やさない、はここで機械的に守る。
 */

import { daysBetween, type DateOnly } from '@/lib/date';

/** 提案・丸めの単位(円)。目標は100円単位にそろえる。 */
export const PLAN_ROUNDING_YEN = 100;

/** 改善の強さの選択肢(%)。1回の目標で、削れる部分をどこまで削るかの上限。 */
export const PLAN_STEP_OPTIONS = [5, 10, 20] as const;

/** 期間の日数(開始日・終了日を含む)。 */
export function planPeriodDays(start: DateOnly, end: DateOnly): number {
  return daysBetween(start, end) + 1;
}

/** 過去の実績から期間ぶんの目安額を出す(1日あたりの平均 × 期間の日数)。 */
export function baselineForPeriod(
  spentYen: number,
  lookbackDays: number,
  periodDays: number,
): number {
  if (lookbackDays <= 0 || spentYen <= 0) return 0;
  return Math.round((spentYen / lookbackDays) * periodDays);
}

export type PlanGenreFacts = {
  /** 過去実績から出した、この期間の目安額(削る前の水準)。 */
  baselineYen: number;
  /** 過去実績のうち「絶対払わざるを得ない」ラベルの割合(0〜1)。 */
  mustPayShare: number;
  /** 課題のあるジャンルか(予算超過・増加傾向・浪費判定が多い等)。 */
  isIssue: boolean;
};

function roundToUnit(yen: number, direction: 'nearest' | 'up' = 'nearest'): number {
  const q = yen / PLAN_ROUNDING_YEN;
  return (direction === 'up' ? Math.ceil(q) : Math.round(q)) * PLAN_ROUNDING_YEN;
}

/** 削れる額の上限。必須ラベルの部分は削らない。 */
function maxCutYen(facts: PlanGenreFacts, stepPercent: number): number {
  const discretionary = facts.baselineYen * (1 - clamp01(facts.mustPayShare));
  return Math.floor((discretionary * stepPercent) / 100);
}

/**
 * AIを使えないとき(APIキー無し・失敗)の決め打ち提案。課題のあるジャンルだけ
 * 削れる部分を stepPercent だけ削り、他は現状維持にする。
 */
export function fallbackTarget(facts: PlanGenreFacts, stepPercent: number): number {
  if (facts.baselineYen <= 0) return 0;
  const cut = facts.isIssue ? maxCutYen(facts, stepPercent) : 0;
  return clampAiTarget(facts.baselineYen - cut, facts, stepPercent);
}

/**
 * AIが返した目標額を範囲に収める。
 *   上限: 過去実績(目標を実績より増やさない)
 *   下限: 実績から「削れる部分 × stepPercent」まで(いきなり大きく削らない)
 */
export function clampAiTarget(
  aiTargetYen: number,
  facts: PlanGenreFacts,
  stepPercent: number,
): number {
  if (facts.baselineYen <= 0) return 0;
  const floor = facts.baselineYen - maxCutYen(facts, stepPercent);
  const clamped = Math.min(Math.max(aiTargetYen, floor), facts.baselineYen);
  // 100円単位に丸めても範囲を出ないようにする(上限・下限はそのまま採る)。
  const rounded = roundToUnit(clamped);
  return Math.min(Math.max(rounded, roundToUnit(floor, 'up')), roundToUnit(facts.baselineYen));
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export type PlanProgressTone = 'normal' | 'attention' | 'over';

export type PlanProgress = {
  spentYen: number;
  targetYen: number;
  remainingYen: number;
  /** 使用率。目標が0円なら null。 */
  ratio: number | null;
  tone: PlanProgressTone;
};

/** 目標に対する進み具合。超過は常に見せる(叱らず見せる)。 */
export function planProgress(spentYen: number, targetYen: number): PlanProgress {
  const remainingYen = targetYen - spentYen;
  const ratio = targetYen > 0 ? spentYen / targetYen : null;
  const tone: PlanProgressTone =
    remainingYen < 0 ? 'over' : ratio !== null && ratio >= 0.7 ? 'attention' : 'normal';
  return { spentYen, targetYen, remainingYen, ratio, tone };
}

/**
 * 期間選択カレンダーのタップで、選択範囲がどう変わるか。
 * 1回目=開始日、2回目=終了日。開始日より前をタップしたら開始日を選び直す。
 * 選び終わった後のタップは、その日から選び直す。
 */
export function nextPlanRange(
  current: { start: DateOnly | null; end: DateOnly | null },
  tapped: DateOnly,
): { start: DateOnly | null; end: DateOnly | null } {
  const { start, end } = current;
  if (start === null || end !== null || tapped < start) return { start: tapped, end: null };
  return { start, end: tapped };
}

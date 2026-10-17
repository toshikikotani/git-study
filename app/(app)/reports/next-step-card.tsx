'use client';

import { formatEstimate, formatProbability } from '@/domain/forecast/format';
import type { ForecastSuggestion } from '@/domain/forecast/types';
import { useOpenCategory } from '../category-sheet';

/**
 * 次の一手(デザイン仕様書の「今日」の「次の一手」と、「分析 › 目標」の「いちばん効く一手」、ADR-090・091):
 * 提案のカテゴリを週に何回へらすと、月末の支出がどれだけへり、確率がどう変わるか。押すとそのカテゴリ(⑦)。
 */
export function NextStepCard({
  suggestion,
  variant = 'today',
}: {
  suggestion: ForecastSuggestion;
  /** today:今日の「次の一手」。goal:分析 › 目標の「いちばん効く一手」。 */
  variant?: 'today' | 'goal';
}) {
  const open = useOpenCategory();
  if (suggestion.probAfter - suggestion.probBefore < 0.01) return null;
  const goal = variant === 'goal';
  return (
    <section
      aria-label={goal ? 'いちばん効く一手' : '次の一手'}
      className="flex flex-col gap-2 rounded-[22px] p-5"
      style={{ background: 'var(--surface)' }}
    >
      <h2 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
        {goal ? 'いちばん効く一手' : '次の一手'}
      </h2>
      <p className="text-[20px] leading-snug font-bold" style={{ color: 'var(--ink)' }}>
        {suggestion.categoryName}を週{suggestion.perWeek}回へらす
      </p>
      <p className="tabular text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {goal
          ? `月末の支出が${formatEstimate(suggestion.savedYen)}へり、目標内の確率も上がります。`
          : `月末の支出が${formatEstimate(suggestion.savedYen)}へり、目標内の確率は${formatProbability(suggestion.probBefore)} → ${formatProbability(suggestion.probAfter)}に。`}
      </p>
      <button
        type="button"
        onClick={() => open(suggestion.categoryId)}
        className="mt-2 inline-flex min-h-11 items-center self-start rounded-full px-5 text-[15px] font-semibold"
        style={{ background: 'var(--button-quiet)', color: 'var(--ink)' }}
      >
        {goal ? `${suggestion.categoryName}をひらく` : `${suggestion.categoryName}の見通しを見る`}
      </button>
    </section>
  );
}

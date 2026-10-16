import type { Route } from 'next';
import Link from 'next/link';

import { formatEstimate, formatProbability } from '@/domain/forecast/format';
import type { ForecastSuggestion } from '@/domain/forecast/types';
import { categoryHref } from '@/lib/category-nav';

/**
 * 次の一手(デザイン仕様書の「次の一手」、ADR-090):提案のカテゴリを週に何回へらすと、月末の支出が
 * どれだけへり、予算内の確率がどう変わるか。押すとそのカテゴリの見通し(「もし」)へ。
 */
export function NextStepCard({
  suggestion,
  monthKey,
}: {
  suggestion: ForecastSuggestion;
  /** 「2026-10」(ジャンル画面の月) */
  monthKey: string;
}) {
  if (suggestion.probAfter - suggestion.probBefore < 0.01) return null;
  return (
    <section
      aria-label="次の一手"
      className="flex flex-col gap-2 rounded-[22px] p-5"
      style={{ background: 'var(--surface)' }}
    >
      <h2 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
        次の一手
      </h2>
      <p className="text-[20px] leading-snug font-bold" style={{ color: 'var(--ink)' }}>
        {suggestion.categoryName}を週{suggestion.perWeek}回へらす
      </p>
      <p className="tabular text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        月末の支出が{formatEstimate(suggestion.savedYen)}へり、予算内の確率は
        {formatProbability(suggestion.probBefore)} → {formatProbability(suggestion.probAfter)}に。
      </p>
      <Link
        href={categoryHref(suggestion.categoryId, monthKey) as Route}
        className="mt-2 inline-flex min-h-11 items-center self-start rounded-full px-5 text-[15px] font-semibold"
        style={{ background: 'var(--button-quiet)', color: 'var(--ink)' }}
      >
        {suggestion.categoryName}の見通しを見る
      </Link>
    </section>
  );
}

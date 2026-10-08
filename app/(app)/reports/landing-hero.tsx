import type { Route } from 'next';
import Link from 'next/link';

import { formatEstimate, formatEstimateRange, formatProbability } from '@/domain/forecast/format';
import type { ForecastSuggestion } from '@/domain/forecast/types';
import { categoryHref } from '@/lib/category-nav';

/**
 * 月末の見込みの見出し(デザインの「見通し」の「月末の支出」、ADR-085):中央を1つ大きく、
 * 予算との差を右上のバッジに、80%の幅と予算に収まる確率をその下に。予算の書き方は「17.0万円」に
 * そろえる(本文・グラフ・注釈で同じ)。
 */
export function LandingHero({
  endLabel,
  landing,
  budgetYen,
  probWithinBudget,
  provisional,
}: {
  /** 「月末」「10月31日」 */
  endLabel: string;
  landing: { p10: number; p50: number; p90: number };
  budgetYen: number | null;
  probWithinBudget: number | null;
  provisional: boolean;
}) {
  const gap = budgetYen === null ? null : landing.p50 - budgetYen;
  return (
    <section
      aria-label={`${endLabel}の支出の見込み`}
      className="flex flex-col gap-3 rounded-[28px] p-6"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {endLabel}の支出
            {provisional ? (
              <span
                className="rounded-full px-2 py-1 text-xs font-semibold"
                style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
              >
                目安
              </span>
            ) : null}
          </h2>
          <p
            className="tabular text-xl font-bold tracking-[-0.02em]"
            style={{ color: 'var(--ink)' }}
          >
            {formatEstimate(landing.p50)}
            {budgetYen !== null ? (
              <span
                className="ml-2 text-base font-normal"
                style={{ color: 'var(--ink-secondary)' }}
              >
                / 予算 {formatEstimate(budgetYen, { approx: false })}
              </span>
            ) : null}
          </p>
        </div>
        {gap !== null ? (
          <span
            className="mt-1 shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
            style={
              gap > 0
                ? { background: 'var(--state-caution-track)', color: 'var(--state-caution)' }
                : { background: 'var(--state-ok-track)', color: 'var(--state-ok)' }
            }
          >
            {gap > 0
              ? `予算を${formatEstimate(gap)} 超えそう`
              : `予算まで ${formatEstimate(-gap)}の余裕`}
          </span>
        ) : null}
      </div>
      <p className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
        80%の確率で {formatEstimateRange(landing.p10, landing.p90)}
        {probWithinBudget !== null ? (
          <>
            {' '}
            ・ 予算に収まる確率{' '}
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>
              {formatProbability(probWithinBudget)}
            </span>
          </>
        ) : null}
      </p>
    </section>
  );
}

/**
 * 次の一手(デザインの「次の一手」、ADR-085):提案のジャンルを週に何回へらすと、月末の支出が
 * どれだけ少なくなるか。押すとそのジャンルの見通し(「もし」)へ。
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
      className="flex flex-col gap-1 rounded-[28px] p-6"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
        次の一手
      </h2>
      <p className="text-xl font-bold tracking-[-0.01em]" style={{ color: 'var(--ink)' }}>
        {suggestion.categoryName}を週{suggestion.perWeek}回へらすと
      </p>
      <p className="tabular text-base leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        月末の支出が{' '}
        <strong style={{ color: 'var(--ink)' }}>{formatEstimate(suggestion.savedYen)}</strong>{' '}
        少なくなる見込みです。
        <span className="block text-xs" style={{ color: 'var(--ink-muted)' }}>
          予算に収まる確率 {formatProbability(suggestion.probBefore)} →{' '}
          {formatProbability(suggestion.probAfter)}
        </span>
      </p>
      <Link
        href={categoryHref(suggestion.categoryId, monthKey) as Route}
        className="mt-3 inline-flex min-h-11 items-center self-start rounded-full px-5 text-base font-semibold"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        {suggestion.categoryName}の見通しを見る
      </Link>
    </section>
  );
}
